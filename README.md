# BENCHRX

A web application and Python worker for running behavioural benchmarks against AI agent endpoints.

BENCHRX connects to an agent, runs a versioned test suite, records evidence and produces a scorecard covering task success, reliability and safety. The repository includes the submission interface, connector implementations, queue processing, deterministic evaluation, database migrations and regression tests.

## What is implemented

- **Benchmark workflow:** agent submission and connection checks, persisted runs, operator review and public scorecard routes.
- **Endpoint connectors:** generic HTTP, Gradio, A2A, LangGraph and OpenAI Agents integration code. Support depends on the target protocol and configuration; see the [compatibility matrix](docs/connectors/compatibility-matrix.md).
- **Worker execution:** FastAPI endpoints and a dedicated queue process, with database leases and saved results for interrupted-run recovery.
- **Evidence-aware scoring:** coverage checks, withheld scores when evidence is insufficient, and safety failures that block a positive benchmark verdict.
- **Optional shadow judging:** AI-assisted judgments stored separately from deterministic public scores.
- **Regression coverage:** TypeScript and Python tests, an HTTP smoke check and a worker synchronization check.

These are source-code capabilities, not a statement that a particular deployment is running this revision.

## How it fits together

| Component | Role |
| --- | --- |
| Next.js, React and TypeScript | Submission, operator interface, scorecards and connector API routes |
| Python and FastAPI | Benchmark dispatch and execution |
| Supabase / PostgreSQL | Agent records, queued runs, evidence, leases and publication views |
| Deterministic evaluator | Test interpretation, coverage gates and score calculation |
| Optional OpenAI judge | Separate shadow evaluation for comparison |

The worker calls configured agent endpoints. It does not download and execute arbitrary agent repositories.

## Run locally

Use Node.js 22 and Python 3.12 to match the repository's CI configuration.

```sh
git clone https://github.com/deangudgeon123-hub/BENCHRX.git
cd BENCHRX
npm ci
npm run dev
```

This starts the web application. Completing a benchmark also requires a configured Supabase database, compatible migrations, a worker and the required server secrets.

For a Python environment, run:

```sh
python -m venv .venv
```

Activate it using the command for your shell, then:

```sh
python -m pip install -r worker/requirements-dev.txt
python -m uvicorn main:app --app-dir worker --host 0.0.0.0 --port 8000
```

For a dedicated queue process:

```sh
python worker/queue_worker.py
```

When that process owns dispatch, set `BENCHRX_POLL_QUEUE=0` on the web worker service. Follow the [staging and testing guide](docs/hardening/TESTING.md) for the configuration and coordinated deployment requirements.

### Configuration

The checked-in environment examples are starting points, not a complete staging configuration.

| Service | Required configuration for connected operation |
| --- | --- |
| Next.js | `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `BENCHRX_ADMIN_TOKEN`, `BENCHRX_ADAPTER_SECRET`, `BENCHRX_APP_ORIGIN`, `BENCHMARK_API_URL`, `BENCHMARK_API_SECRET` |
| Worker | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `BENCHMARK_API_SECRET` |
| Worker using adapters | Matching `BENCHRX_ADAPTER_SECRET` and explicit `BENCHRX_ADAPTER_ORIGINS` |
| Optional shadow judge | `OPENAI_API_KEY`; additional settings are in [worker/config.py](worker/config.py) |

Use separate secrets for operator access, adapters and worker requests. The access controls require secrets of at least 32 characters. Keep service-role keys and other secrets server-side.

Endpoint execution requires public HTTPS targets; localhost is not a supported benchmark target. Adapter testing needs a matching HTTPS origin or tunnel. Protected Vercel previews also require the bypass configuration described in the staging guide.

Review **all** files in [supabase/migrations](supabase/migrations) against the database's existing state. The older staging guide discusses migrations 001–006; the directory also contains a later result-classification migration. Do not blindly reapply migrations to an existing database. Branch names and deployment status in historical hardening notes describe those checkpoints, not necessarily the current deployment.

## Development checks

```sh
npm test
npm run typecheck
npm run build
node scripts/http-smoke.mjs
python -m pytest -q
python scripts/verify-worker-sync.py
```

Install the Python development requirements before running the Python checks. The HTTP smoke script expects the built application. These commands are documented checks, not a claim that they pass on every environment or revision.

## Reading the results

A score describes the observations collected by a particular suite and evaluator version. It is not a certification, a general safety guarantee or proof of production readiness.

The evaluator is still being refined. The [v2.37 review](docs/hardening/evaluator-v2.37.md) records remaining work on evidence interpretation, valid refusals, uncertainty responses and broader independent labeling. Fixture-based connector tests also do not establish compatibility with every live deployment.

## Documentation

- [Architecture and source map](docs/ARCHITECTURE.md)
- [Connector compatibility and evidence](docs/connectors/compatibility-matrix.md)
- [OpenAI Agents connector](docs/connectors/openai-agents.md)
- [Local checks and staging configuration](docs/hardening/TESTING.md)
- [Evaluator v2.37 review](docs/hardening/evaluator-v2.37.md)
- [Original V1 scope](docs/V1_SCOPE.md) — historical planning, not the current implementation specification
