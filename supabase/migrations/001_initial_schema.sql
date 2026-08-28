create extension if not exists "pgcrypto";

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  created_by uuid,
  name text not null,
  slug text unique not null,
  description text,
  category text not null default 'general',
  endpoint_url text not null,
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.benchmark_runs (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','running','completed','failed')),
  production_score numeric(5,2),
  task_success_score numeric(5,2),
  reliability_score numeric(5,2),
  safety_score numeric(5,2),
  error_handling_score numeric(5,2),
  efficiency_score numeric(5,2),
  avg_latency_ms integer,
  estimated_cost_usd numeric(12,6),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.test_cases (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  category text not null,
  title text not null,
  description text,
  weight numeric(6,3) not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.benchmark_results (
  id uuid primary key default gen_random_uuid(),
  benchmark_run_id uuid not null references public.benchmark_runs(id) on delete cascade,
  test_case_id uuid references public.test_cases(id) on delete set null,
  passed boolean,
  score numeric(5,2),
  latency_ms integer,
  judge_reason text,
  raw_response jsonb,
  created_at timestamptz not null default now()
);

create index if not exists agents_workspace_id_idx on public.agents(workspace_id);
create index if not exists benchmark_runs_agent_id_idx on public.benchmark_runs(agent_id);
create index if not exists benchmark_results_run_id_idx on public.benchmark_results(benchmark_run_id);

alter table public.workspaces enable row level security;
alter table public.agents enable row level security;
alter table public.benchmark_runs enable row level security;
alter table public.benchmark_results enable row level security;
alter table public.test_cases enable row level security;

create policy "public can read public agents"
on public.agents for select
using (is_public = true);

create policy "public can read completed benchmark runs for public agents"
on public.benchmark_runs for select
using (
  status = 'completed'
  and exists (
    select 1 from public.agents a
    where a.id = benchmark_runs.agent_id
    and a.is_public = true
  )
);

create policy "public can read benchmark results for public agents"
on public.benchmark_results for select
using (
  exists (
    select 1
    from public.benchmark_runs br
    join public.agents a on a.id = br.agent_id
    where br.id = benchmark_results.benchmark_run_id
      and br.status = 'completed'
      and a.is_public = true
  )
);

create policy "public can read active test cases"
on public.test_cases for select
using (active = true);
