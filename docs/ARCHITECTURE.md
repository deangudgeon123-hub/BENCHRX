# BENCHRX architecture

This overview describes the implementation in this repository. It does not verify the configuration or availability of a deployed service.

## Request and execution flow

1. The Next.js interface submits an agent configuration and performs connection checks through server routes.
2. Server-side connector code validates and translates supported endpoint configurations.
3. Supabase stores the run and its queue state. The web application can trigger the worker; a dedicated queue process can also dispatch persisted work.
4. The Python runner claims a run using database leases, invokes the configured endpoint and saves test evidence.
5. Deterministic evaluation interprets the observations. Scoring applies coverage requirements and safety gates.
6. Scorecard routes read the published result projection. Optional shadow judgments are stored separately.

## Source map

| Location | Responsibility |
| --- | --- |
| `app/benchmark` | Benchmark submission interface |
| `app/admin` | Operator review interface |
| `app/agents/[slug]` | Agent scorecard |
| `app/api/agents` | Agent and run API routes |
| `app/api/adapters` | Connector adapter routes |
| `lib/server/connectors` | Protocol discovery, validation and transport handling |
| `lib/server/access.ts` | Shared access and request helpers |
| `lib/server/pinned-https.ts` | Public HTTPS endpoint validation and pinned requests |
| `worker/main.py` | FastAPI service and dispatch loop |
| `worker/queue_worker.py` | Dedicated queue entry point |
| `worker/benchmarks/runner.py` | Run execution, leases and evidence persistence |
| `worker/benchmarks/policy.py` | Coverage and readiness policy |
| `worker/benchmarks/scoring.py` | Category score calculation |
| `worker/judges` | Optional AI shadow evaluation |
| `supabase/migrations` | Database schema, permissions and run-management changes |
| `tests` | Regression tests |

## Connector boundary

The implementation includes generic HTTP, Gradio, A2A, LangGraph and OpenAI Agents connectors. Their contracts and evidence differ. Consult the [compatibility matrix](connectors/compatibility-matrix.md) before assuming a target will work.

Agent execution happens at the configured endpoint. BENCHRX does not execute downloaded repository code. Public HTTPS restrictions, response bounds and adapter-origin configuration form part of this boundary.

## Evidence and scoring

The policy requires the planned result set, checks observed and complete evidence, and withholds the aggregate score when category coverage is insufficient. Observed safety failures veto a positive readiness verdict. A positive benchmark verdict still refers only to the suite's observations.

Suite, evaluator and scoring versions are recorded for provenance. Optional shadow judging does not replace the deterministic public score. See the [current evaluator review](hardening/evaluator-v2.37.md) for known interpretation limits and remaining validation work.

## Persistence and operation

Database migrations add execution leases, evidence projections and queue-admission controls. The runner uses claims and lease renewal to coordinate execution and recover persisted work.

The web service and dedicated queue process share the worker configuration. When the dedicated process owns dispatch, disable polling in the web service with `BENCHRX_POLL_QUEUE=0`. Database fencing remains necessary during overlap or recovery.

Frontend, worker and database changes must remain compatible. Review the [testing and staging guide](hardening/TESTING.md), then check the entire migration directory against the target database. Historical branch names and rollout statements in that guide are checkpoint notes.

## What is not established by this architecture

- Compatibility with every agent deployment.
- Independently measured evaluator accuracy across general agent behaviour.
- Certification, regulatory compliance or general production safety.
- The current state of any hosted frontend, worker or database.

The [original V1 scope](V1_SCOPE.md) remains available as historical planning material.
