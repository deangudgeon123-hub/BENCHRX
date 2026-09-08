begin;
alter table public.benchmark_runs add column lease_token uuid, add column lease_expires_at timestamptz,
 add column execution_attempt integer not null default 0, add column connection_snapshot jsonb;
create unique index benchmark_results_run_test_unique on public.benchmark_results(benchmark_run_id,test_key) where test_key is not null;
create index benchmark_runs_dispatch_idx on public.benchmark_runs(status,lease_expires_at,created_at);

create function public.benchrx_claim_run(p_run_id uuid,p_token uuid,p_manifest jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.benchmark_runs; a public.agents;
begin
 select * into r from public.benchmark_runs where id=p_run_id for update skip locked;
 if not found then return null; end if;
 if not (r.status='queued' or (r.status='running' and r.lease_token is not null and r.lease_expires_at < clock_timestamp())) then return null; end if;
 if r.suite_manifest is not null and r.suite_manifest <> p_manifest then raise exception 'Incompatible run manifest'; end if;
 select * into a from public.agents where id=r.agent_id;
 if not found then raise exception 'Agent not found'; end if;
 update public.benchmark_runs set status='running',started_at=coalesce(started_at,clock_timestamp()),
 lease_token=p_token,lease_expires_at=clock_timestamp()+interval '120 seconds',execution_attempt=execution_attempt+1,
 suite_manifest=p_manifest,suite_version=p_manifest->>'suite_version',scoring_policy_version=p_manifest->>'scoring_policy_version',
 connection_snapshot=coalesce(connection_snapshot,jsonb_build_object('endpoint_url',a.endpoint_url,'description',a.description,'category',a.category))
 where id=p_run_id returning * into r;
 return jsonb_build_object('id',r.id,'agent_id',r.agent_id,'connection',r.connection_snapshot);
end $$;

create function public.benchrx_renew_lease(p_run_id uuid,p_token uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
 update public.benchmark_runs set lease_expires_at=clock_timestamp()+interval '120 seconds'
 where id=p_run_id and status='running' and lease_token=p_token and lease_expires_at>clock_timestamp();
 return found;
end $$;

create function public.benchrx_save_result(p_run_id uuid,p_token uuid,p_result jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare r public.benchmark_runs; t jsonb;
begin
 select * into r from public.benchmark_runs where id=p_run_id for update;
 if not found or r.status<>'running' or r.lease_token is distinct from p_token or r.lease_expires_at<=clock_timestamp() then raise exception 'Execution lease lost'; end if;
 select value into t from jsonb_array_elements(r.suite_manifest->'tests') where value->>'key'=p_result->>'test_key';
 if t is null then raise exception 'Test outside run manifest'; end if;
 insert into public.benchmark_results(benchmark_run_id,test_key,test_snapshot,passed,score,latency_ms,judge_reason,raw_response,execution_metadata,observed,evidence_complete,outcome_type,score_included)
 values(p_run_id,t->>'key',t,(p_result->>'passed')::boolean,(p_result->>'score')::numeric,(p_result->>'latency_ms')::integer,p_result->>'judge_reason',p_result->'raw_response',p_result->'execution_metadata',(p_result->>'observed')::boolean,(p_result->>'evidence_complete')::boolean,p_result->>'outcome_type',(p_result->>'score_included')::boolean);
 return true;
end $$;

create function public.benchrx_finish_run(p_run_id uuid,p_token uuid,p_summary jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare r public.benchmark_runs;
begin
 select * into r from public.benchmark_runs where id=p_run_id for update;
 if not found or r.status<>'running' or r.lease_token is distinct from p_token or r.lease_expires_at<=clock_timestamp() then raise exception 'Execution lease lost'; end if;
 if exists(select 1 from jsonb_array_elements(r.suite_manifest->'tests') t where not exists(select 1 from public.benchmark_results b where b.benchmark_run_id=p_run_id and b.test_key=t->>'key'))
 or (select count(*) from public.benchmark_results where benchmark_run_id=p_run_id)<>jsonb_array_length(r.suite_manifest->'tests') then raise exception 'Incomplete result set'; end if;
 update public.benchmark_runs set status='completed',completed_at=clock_timestamp(),lease_token=null,lease_expires_at=null,
 production_score=(p_summary->>'production_score')::numeric,task_success_score=(p_summary->>'task_success_score')::numeric,
 reliability_score=(p_summary->>'reliability_score')::numeric,safety_score=(p_summary->>'safety_score')::numeric,
 error_handling_score=(p_summary->>'error_handling_score')::numeric,efficiency_score=(p_summary->>'efficiency_score')::numeric,
 avg_latency_ms=(p_summary->>'avg_latency_ms')::integer,coverage=p_summary->'coverage',readiness_status=p_summary->>'readiness_status',
 readiness_reasons=p_summary->'readiness_reasons',critical_failures=p_summary->'critical_failures',missing_critical_tests=p_summary->'missing_critical_tests'
 where id=p_run_id;
 return true;
end $$;

create function public.benchrx_fail_run(p_run_id uuid,p_token uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
 update public.benchmark_runs set status='failed',completed_at=clock_timestamp(),lease_token=null,lease_expires_at=null
 where id=p_run_id and status='running' and lease_token=p_token and lease_expires_at>clock_timestamp();
 return found;
end $$;

revoke all on function public.benchrx_claim_run(uuid,uuid,jsonb),public.benchrx_renew_lease(uuid,uuid),public.benchrx_save_result(uuid,uuid,jsonb),public.benchrx_finish_run(uuid,uuid,jsonb),public.benchrx_fail_run(uuid,uuid) from public,anon,authenticated;
grant execute on function public.benchrx_claim_run(uuid,uuid,jsonb),public.benchrx_renew_lease(uuid,uuid),public.benchrx_save_result(uuid,uuid,jsonb),public.benchrx_finish_run(uuid,uuid,jsonb),public.benchrx_fail_run(uuid,uuid) to service_role;

create table public.benchmark_shadow_judgments (
 benchmark_run_id uuid references public.benchmark_runs(id) on delete cascade,
 test_key text not null,judge jsonb not null,created_at timestamptz not null default now(),
 primary key(benchmark_run_id,test_key)
);
alter table public.benchmark_shadow_judgments enable row level security;
revoke all on public.benchmark_shadow_judgments from public,anon,authenticated;
grant all on public.benchmark_shadow_judgments to service_role;

commit;
