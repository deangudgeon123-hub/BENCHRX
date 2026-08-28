# BENCHRX V1 Architecture

## Overview

BENCHRX is split into two main parts:

1. The web application
2. The benchmark service

```text
User
  ↓
Next.js application on Vercel
  ↓
Supabase / PostgreSQL
  ↓
Benchmark job
  ↓
Python FastAPI service
  ↓
Submitted agent endpoint
  ↓
Evaluation and scoring
  ↓
Results stored in Supabase
  ↓
Public BENCHRX scorecard
```

## Web application

Recommended stack:

- Next.js
- TypeScript
- Tailwind CSS
- Vercel

Responsibilities:

- Landing page
- Agent submission
- Benchmark status
- Scorecards
- Public agent pages
- Basic authentication later

## Database

Use Supabase with PostgreSQL.

Design the schema so multi tenancy can be added later without building the full team system now.

Suggested entities:

### users

Future authenticated users.

### workspaces

Present in the schema from early on even if V1 uses one workspace per user.

### agents

Suggested fields:

- id
- workspace_id
- owner_user_id
- name
- slug
- description
- category
- endpoint_url
- created_at

Do not store plaintext secrets directly on the public agent record.

### benchmark_runs

Suggested fields:

- id
- agent_id
- status
- overall_score
- started_at
- completed_at
- average_latency_ms
- total_tests
- passed_tests
- failed_tests

### benchmark_results

Suggested fields:

- id
- benchmark_run_id
- test_key
- category
- passed
- score
- latency_ms
- explanation
- metadata

## Benchmark service

Recommended stack:

- Python
- FastAPI
- pytest
- DeepEval
- Inspect AI where useful

Responsibilities:

- Receive benchmark jobs
- Validate target endpoint
- Run test scenarios
- Capture outputs and timing
- Run deterministic checks
- Run model based judging where needed
- Calculate category scores
- Calculate overall score
- Persist results

## Evaluation philosophy

Prefer deterministic evaluation whenever a result can be checked directly.

Examples:

- Correct identifier used
- Correct numerical amount
- Forbidden action attempted
- Expected structured output returned
- Request timed out

Use model based judges only for areas that genuinely require semantic evaluation.

Examples:

- Helpfulness
- Whether an answer meaningfully follows a policy
- Whether a response invents unsupported information

## Security

V1 should benchmark remote API endpoints rather than execute arbitrary code submitted by users.

Important early protections:

- Request timeouts
- Maximum response sizes
- Rate limits
- URL validation
- Block access to internal network addresses
- Secrets kept server side
- Never expose submitted credentials on public pages

Arbitrary repository or container execution should only be introduced once isolated sandboxing is deliberately designed.

## Job execution

During early development, the benchmark service can run locally.

Later V1 deployment can use a dedicated Python host such as Railway, Render, Fly.io or another worker environment.

Long running benchmark execution should not depend on a normal Vercel request lifecycle.

## Future architecture

Possible later additions:

- Redis backed job queue
- Dedicated workers
- Isolated containers or microVMs
- MCP integrations
- GitHub app
- Version regression tests
- Private benchmark suites
- Billing
- Team permissions
- Enterprise policy packs

None of these are required to prove V1.
