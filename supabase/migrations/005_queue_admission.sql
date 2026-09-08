begin;
-- Global admission lock makes per-agent deduplication and queue limits atomic.
-- Initial limits are operational containment, not statistical benchmark thresholds.
create function public.benchrx_enqueue_run(p_agent_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.agents; r public.benchmark_runs;
begin
 perform pg_advisory_xact_lock(782431901);
 select * into a from public.agents where id=p_agent_id;
 if not found then raise exception 'Agent not found'; end if;
 if exists(select 1 from public.benchmark_runs where agent_id=p_agent_id and status in ('queued','running')) then
  raise exception 'Agent already has active work';
 end if;
 if exists(select 1 from public.benchmark_runs where agent_id=p_agent_id and created_at>clock_timestamp()-interval '60 seconds') then
  raise exception 'Agent cooldown active';
 end if;
 if (select count(*) from public.benchmark_runs where status in ('queued','running'))>=10 or
    (select count(*) from public.benchmark_runs where created_at>clock_timestamp()-interval '1 hour')>=30 then
  raise exception 'Queue admission limit reached';
 end if;
 insert into public.benchmark_runs(agent_id,workspace_id,status) values(a.id,a.workspace_id,'queued') returning * into r;
 return jsonb_build_object('id',r.id,'status',r.status,'created_at',r.created_at);
end $$;
revoke all on function public.benchrx_enqueue_run(uuid) from public,anon,authenticated;
grant execute on function public.benchrx_enqueue_run(uuid) to service_role;
commit;
