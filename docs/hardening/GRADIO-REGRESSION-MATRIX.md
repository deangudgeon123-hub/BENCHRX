# Schema-driven gateway regression matrix

The assertions below use deterministic fixtures, not mutable live-agent scores.
No fixture changes benchmark questions or evaluator expectations.

| Case | Regression file(s) | Required property |
| --- | --- | --- |
| One-string predict | gradio-input, connectors | Existing string payload retained |
| Question endpoint | gradio-input | Semantic mapping works without API-name guess |
| Frontier multi-output | gradio-output-label-mapping, gradio-invocation | Answer index 3 retained |
| First Agent chain | gradio-chaining, gradio-invocation | Hidden State slots, shared session, assistant-only output |
| Travel structured | gradio-discovery, gradio-input | Preferences mapped; fixed fields not invented |
| MCQ required options | gradio-input | Question mapped; all options REQUIRED |
| Proven object message | gradio-message-shape | Text/files only when schema proves shape |
| Ambiguous message | gradio-input | No silent choice between equally plausible fields |
| Required multimodal input | gradio-compatibility | Recognized endpoint; no automatic text recipe |
| Login/helper callback | gradio-compatibility | No benchmark recipe |
| Legacy call | connectors, gradio-invocation | Existing POST/result route retained |
| Named call | gradio-invocation, gradio-transport | Explicit public snippet and valid named arguments |
| Queue/session | gradio-6-queue-fallback, gradio-workflow | Public config evidence; session/event matching |
| Non-compatibility 404 | gradio-transport | No alternative job without matching capability evidence |
| Malformed schema | gradio-schema | Bounded counts and fail-closed parsing |
| Malformed SSE/event ID | gradio-output, connector-normalization, gradio-regression-matrix | No incomplete response accepted; malformed IDs never create poll URLs |
| State wiring | gradio-schema, gradio-chaining | Wire versus visible indices retained |
| Unsafe defaults | gradio-templates, gradio-schema | Credential redaction; typed defaults; unresolved guard |

Files refer to `tests/<name>.test.ts`.

Commands:

```sh
node --experimental-strip-types --test tests/gradio-*.test.ts tests/connector-normalization.test.ts tests/connectors.test.ts
npm test
npm run typecheck
npm run build
python3 scripts/verify-worker-sync.py
# In worker/, with requirements.txt and pytest installed:
python -m pytest -q
```

Diff review baseline: `12495c5ad2f6ecb2a25afb3d883d4272926ce2a2`.
No changes to scoring, readiness, benchmark content, worker, database, pinned HTTPS,
authentication or publication code. No Space owner/name/URL branching or new raw logs.
The `huggingface.co`/`.hf.space` host validation is provider validation, not Space-specific
dispatch. Automatic stateful discovery still recognizes the established endpoint pair;
arbitrary dependency graph synthesis is deferred and manual workflows remain supported.

Stage 7 results (2026-09-10): all 79 Node tests pass, typecheck passes, production build
passes, 29 worker hashes verify, and diff whitespace checks pass. Python pytest could
not start because pytest is absent. Installing it and worker requirements in a disposable
environment was blocked by proxy timeouts/network approval cancellation. No Python test
pass is claimed; worker code is unchanged. Run that suite in the configured worker CI.
