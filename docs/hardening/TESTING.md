# Testing the hardening branch

This is a review/test branch, not a production rollout. Main and the branch watched by Render have not been changed. Do not merge or deploy the new worker against an unmigrated database.

## Local checks (no live service credentials needed)

```sh
git fetch origin
git switch feature/security-measurement-hardening
npm ci
npm test
npm run typecheck
npm run build
node scripts/http-smoke.mjs
python -m venv .venv
```

Activate `.venv` using the command for your shell, then:

```sh
python -m pip install -r worker/requirements-dev.txt
python -m pytest -q
python scripts/verify-worker-sync.py
```

Use Node 22+ and Python 3.12+. The HTTP smoke test starts a local production server with fixture secrets and checks ten route/authentication/CSRF responses. It does not contact Supabase or run a paid benchmark.

## End-to-end staging setup

Use a separate Supabase project and preview environment. Back up any database before migrations. A fresh staging database needs migrations 001 through 006 in filename order; an existing 001 database needs 002 through 006. Do not reapply 001 to an existing database. SQL files are under `supabase/migrations`.

Set these **server environment variables** in the Next.js preview:

- `NEXT_PUBLIC_SUPABASE_URL`: staging Supabase URL.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: no longer used by the scorecard; browser roles cannot query the private tables or publication views after migration 006.
- `SUPABASE_SERVICE_ROLE_KEY`: staging service key; never prefix it with `NEXT_PUBLIC_`.
- `BENCHRX_ADMIN_TOKEN`: fresh random operator secret, at least 32 characters.
- `BENCHRX_ADAPTER_SECRET`: a different fresh secret, at least 32 characters.
- `BENCHRX_APP_ORIGIN`: exact HTTPS origin of this preview, with no path or query.
- `BENCHMARK_API_URL`: HTTPS URL of a separate staging worker.
- `BENCHMARK_API_SECRET`: a third fresh secret, at least 32 characters.

Set these on the staging worker:

- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`: the same staging database.
- `BENCHMARK_API_SECRET`: matches the preview's worker secret.
- `BENCHRX_ADAPTER_SECRET`: matches the preview's adapter secret.
- `BENCHRX_ADAPTER_ORIGINS`: comma-separated exact HTTPS preview origins allowed to receive adapter credentials.
- `BENCHRX_POLL_QUEUE=1`: recover persisted queued and expired-lease work.
- Optional `VERCEL_AUTOMATION_BYPASS_SECRET`: only for protected preview adapters; forwarded only to allowlisted adapter origins and paths.
- Leave `OPENAI_API_KEY` unset initially. Shadow AI is optional and never changes the public score.

Start the worker from the repository root with:

```sh
python -m uvicorn main:app --app-dir worker --host 0.0.0.0 --port 8000
```

For local frontend development, run `npm run dev`. Native endpoint tests require public HTTPS endpoints on port 443. Adapter end-to-end testing requires an HTTPS preview/tunnel with matching configured origins; localhost targets are intentionally rejected by benchmark execution.

Visit `/operator`. The browser login username is `benchrx`; the password is your `BENCHRX_ADMIN_TOKEN`. This is temporary operator-only containment, not customer authentication or tenancy. Then use `/benchmark` and `/admin`. Anonymous submissions, reruns, connection tests and adapter execution are denied.

Check a complete native run and a stateful Gradio workflow against controlled fixtures. Verify fresh Gradio sessions between tests and shared state within workflow steps. Verify an interrupted worker resumes saved evidence without overwriting it, a duplicate claim is refused, and an old lease cannot finalize. Test RLS through the actual Supabase REST API with both anonymous and authenticated roles, not only through the website.

Never put live secrets in screenshots, bug reports or public agent names/descriptions. Configuration and raw evidence remain private; known secrets are redacted before evidence storage and shadow judging. Arbitrary unknown secret strings cannot be perfectly identified by pattern matching.

## Coordinated release constraints

1. Verify migration compatibility, backups and isolated staging before any production promotion.
2. Drain old queued/running work and stop the old dispatcher. Legacy running jobs without leases are deliberately not reclaimed by the new worker.
3. Apply migrations and deploy matching frontend and worker together in a maintenance window. Migration 004 revokes base-table reads; old frontends using those tables will stop working. New authenticated adapter POST envelopes are incompatible with the old worker.
4. Set the three independent secrets and exact trusted origins; enable queue polling only on the intended dispatcher.
5. Check production HTTP access controls and real Supabase grants before restoring traffic. Disable old previews with production service credentials.
6. Rollback requires a compatible frontend/worker pair and a considered database plan. Do not restore broad anonymous grants or revert just one runtime.

Render sync is **not activated** in this checkpoint. Its current branch remains `feature/generic-connector-reliability`. Compare its worker against the frozen hardening manifest with:

```sh
git fetch origin
python scripts/verify-worker-sync.py --compare origin/feature/generic-connector-reliability
```

The expected current result is drift. After staging verification, copy the reviewed worker files to a separate deployment-sync proposal, verify hashes, and obtain explicit merge approval. Never merge the Render compatibility branch into main.

## Migration 006: invoker publication views

Apply `006_public_views_security_invoker.sql` once to staging after 001–005, and deploy the matching scorecard change. Migrations 001–005 are unchanged. PostgreSQL 15+ is required for `security_invoker`.

The three publication views now run with caller permissions and retain their security barriers and existing projection/filter definitions. Only the server-side `service_role` may query them. The Next.js scorecard uses `SUPABASE_SERVICE_ROLE_KEY` in a server-only module; it renders the same safe projections. Do not grant private base-table access to anonymous/authenticated roles to make invoker views readable. Direct anonymous Supabase REST reads of the views are intentionally denied.

Check the staging advisor again after application. These tests verify local PostgreSQL semantics; they do not establish that the migration has already been applied to staging.
