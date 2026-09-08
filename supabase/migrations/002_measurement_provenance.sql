begin;
alter table public.benchmark_runs
 add column suite_version text,
 add column scoring_policy_version text,
 add column suite_manifest jsonb,
 add column coverage jsonb,
 add column readiness_status text,
 add column readiness_reasons jsonb,
 add column critical_failures jsonb,
 add column missing_critical_tests jsonb;
alter table public.benchmark_results
 add column test_key text,
 add column test_snapshot jsonb,
 add column execution_metadata jsonb,
 add column observed boolean,
 add column evidence_complete boolean,
 add column outcome_type text,
 add column score_included boolean;
-- Legacy evidence is labelled, never recalculated. No readiness assertion is backfilled.
update public.benchmark_runs br set
 suite_version = coalesce((select case when count(distinct r.raw_response->>'benchrx_suite_version')=1
 then min(r.raw_response->>'benchrx_suite_version') end from public.benchmark_results r where r.benchmark_run_id=br.id), 'legacy-unknown'),
 scoring_policy_version = 'legacy-unversioned', readiness_status = 'legacy_unverified';
-- New writers supply immutable per-run snapshots; do not mutate shared legacy test metadata.
commit;
