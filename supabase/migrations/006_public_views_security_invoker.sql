begin;

-- PostgreSQL 15+ (Supabase): check underlying permissions/RLS as the caller.
-- Retain the existing security barriers, safe projections and publication filters.
alter view public.public_agents set (security_invoker = true);
alter view public.public_benchmark_runs set (security_invoker = true);
alter view public.public_benchmark_results set (security_invoker = true);

-- Invoker views do not confer access to private tables. Do not grant those tables
-- (especially raw_response/test_snapshot/connection_snapshot) to browser roles.
-- The Next.js server reads these projections with its existing service credential;
-- only the projected public fields are rendered. Direct browser DB reads are denied.
revoke all on public.public_agents, public.public_benchmark_runs,
  public.public_benchmark_results from public, anon, authenticated;
grant select on public.public_agents, public.public_benchmark_runs,
  public.public_benchmark_results to service_role;

commit;
