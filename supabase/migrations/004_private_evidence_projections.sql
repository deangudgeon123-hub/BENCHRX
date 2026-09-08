begin;
-- RLS is a row filter, not column secrecy. Anonymous/authenticated clients cannot
-- select the underlying rows. Only intentionally narrow publication views are granted.
revoke all on public.agents,public.benchmark_runs,public.benchmark_results,public.test_cases,public.workspaces from public,anon,authenticated;
grant all on public.agents,public.benchmark_runs,public.benchmark_results,public.test_cases,public.workspaces to service_role;

create view public.public_agents with (security_barrier=true) as
 select id,name,slug,description,category,created_at from public.agents where is_public=true;
create view public.public_benchmark_runs with (security_barrier=true) as
 select br.id,br.agent_id,br.status,br.production_score,br.task_success_score,br.reliability_score,br.safety_score,
 br.error_handling_score,br.efficiency_score,br.avg_latency_ms,br.created_at,br.completed_at,
 br.suite_version,br.scoring_policy_version,br.coverage,br.readiness_status,br.readiness_reasons,br.critical_failures
 from public.benchmark_runs br join public.agents a on a.id=br.agent_id where a.is_public=true and br.status='completed';
create view public.public_benchmark_results with (security_barrier=true) as
 select r.id,r.benchmark_run_id,r.passed,r.score,r.latency_ms,r.created_at,
 case when r.outcome_type is null then 'Legacy evidence; original diagnostic details are private'
      when r.outcome_type='connector_diagnostic' then 'Connector contract diagnostic'
      when r.outcome_type='unobserved' then 'No authored response observed; cause not attributed'
      when r.outcome_type='inconclusive' then 'Partial observation; verdict inconclusive'
      when r.passed=true then 'Observed response met the recorded test contract'
      when r.passed=false then 'Observed response did not meet the recorded test contract'
      else 'Legacy evidence; original diagnostic details are private' end as judge_reason,
 jsonb_build_object('outcome_type',r.outcome_type,'observed',r.observed,'evidence_complete',r.evidence_complete,'score_included',r.score_included,
 'benchrx_diagnostic',coalesce(r.test_snapshot->>'category',t.category)='error_handling') as raw_response,
 jsonb_build_object('key',coalesce(r.test_key,t.key),'title',coalesce(r.test_snapshot->>'title',t.title),
 'category',coalesce(r.test_snapshot->>'category',t.category),'description',null) as test_cases
 from public.benchmark_results r join public.benchmark_runs br on br.id=r.benchmark_run_id
 join public.agents a on a.id=br.agent_id left join public.test_cases t on t.id=r.test_case_id
 where a.is_public=true and br.status='completed';
-- These are deliberate publication projections, owned by the migration role. The
-- explicit predicate and columns are the boundary; never add raw fields or SELECT *.
revoke all on public.public_agents,public.public_benchmark_runs,public.public_benchmark_results from public,anon,authenticated;
grant select on public.public_agents,public.public_benchmark_runs,public.public_benchmark_results to anon,authenticated,service_role;
commit;
