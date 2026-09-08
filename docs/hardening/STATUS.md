# Hardening checkpoint — 8 September 2026

Branch: `feature/security-measurement-hardening`, based on canonical `feature/gradio-workflows` at `c505b21`. Main and the watched Render branch remain unchanged. No merges or live migrations were performed.

## Implemented

- Trusted execution metadata determines observation; agent JSON error/status fields cannot hide authored failures. Real authored responses on error statuses remain observed. Partial paired outcomes retain decisive observed failures.
- Exact/token, JSON-only, clarification, uncertainty and acknowledgement regression fixes. Original 31 benchmark questions are unchanged.
- Versioned manifests, immutable per-run test snapshots, legacy-policy separation and incompatible-history delta suppression.
- Documented category coverage minimums, mandatory safety and uncertainty observations, and observed safety failure vetoes. Shadow AI and efficiency remain outside the production arithmetic. Diagnostics are excluded for all connector types.
- Gradio assistant-only extraction and completed SSE frames; pinned HTTPS workflow sessions replace the SDK network path. Fresh session per benchmark request, shared state across workflow steps, bounded time/bytes, invalid dependencies rejected.
- Public-network/DNS-pinning safeguards on native and adapter paths; redirects prohibited; prototype traversal and excessive JSON-path indexes rejected.
- Authenticated worker commands with UUID validation, pre-body authentication and command-size/time bounds.
- Database atomic claims, lease renewal/fencing, immutable per-test persistence, complete-result-set finalization and persisted queue recovery. Atomic queue admission limits duplicate runs and capacity.
- Private base tables; narrow public views exclude raw evidence, URLs and connector settings. Protected admin/operator and adapter routes, separate secrets, configuration moved out of adapter request URLs, known-secret redaction and sanitized errors.
- Shadow judgment after deterministic completion, blinded to deterministic verdicts, local schema/threshold validation, bounded evidence and rubric version tagging. Canonical pass threshold stays 75.
- Worker hash manifest and regression CI; production HTTP smoke script and staging instructions.

## Verification at this checkpoint

- Python: 58 passing tests, including evaluator counterexamples, gate rules, native egress, worker authentication, body bounds, runner resume, shadow isolation and redaction.
- JavaScript/PostgreSQL-engine tests: 16 passing tests, including Gradio session isolation, stream completion, JSON paths, version comparisons, private projections, leases and queue admission.
- TypeScript checks and production Next.js build passed.
- Ten production HTTP authentication/CSRF checks passed with fixture credentials and no live database.
- npm audit reports zero known vulnerabilities after a PostCSS override. Python audit originally found vulnerable dependencies; FastAPI/Starlette, python-dotenv and pytest have been updated and regression-tested. Final Python advisory rescan is not yet confirmed.
- Database tests use local PGlite. They verify PostgreSQL function behavior, not live Supabase grants or simultaneous multi-process fault injection.

## Remaining issues and merge decision

**Not cleared for production merge yet.** This checkpoint is available for review and isolated testing.

- **Critical:** no remaining demonstrated Critical exploit in the patched/tested paths. Existing deployments have not received these fixes; their exposure is not resolved merely by this branch.
- **High:** staging migration/real RLS validation and a coordinated frontend/worker rollout remain unverified. Render worker behavior is still out of sync; no watched-branch push was made because database compatibility has not been established. The Render connector requires the user to select a workspace before service inspection. Live Gradio compatibility and simultaneous worker crash/lease recovery need staging verification.
- **Medium:** semantic evaluators remain lexical heuristics; safety canary/ground-truth validation and a larger adjudicated calibration corpus are still needed. No certification or general production-readiness claim is justified. Missingness is not proof of provider fault. Queue/shadow operational monitoring and private evidence retention need explicit operating procedures. Exactly-once remote side effects cannot be guaranteed after an ambiguous network failure, even with fenced database writes.
- **Low:** dependency/test-tool deprecation warnings and formatting/maintainability cleanup remain. The temporary shared operator credential is not a replacement for future Auth and tenancy.

Auth/multi-tenancy, private provider-credential product support, Declared Purpose and public onboarding remain intentionally deferred. Public launch is blocked until those access/ownership and operating controls are designed and validated.

The existing Render branch has known Shadow drift: 80 versus canonical 75 pass threshold, selected-test differences and rubric/dimension differences. The manifest makes worker drift detectable; deployment synchronization is still pending, not claimed complete.

See `TESTING.md` for runnable commands and environment/migration prerequisites. See `PLAN.md` for the readiness rule written before implementation. Full changed files and commits are available in the branch comparison against `feature/gradio-workflows`.
