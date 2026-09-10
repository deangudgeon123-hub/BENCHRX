# Schema-driven Gradio: final acceptance checkpoint

Date: 2026-09-10. Branch: `feature/security-measurement-hardening`.
Baseline: `12495c5ad2f6ecb2a25afb3d883d4272926ce2a2`.

## Status

Stages 0–7 are implemented and tested. Stage 8 live investigation found and fixed
a generic output-selection/State-slot bug, with a regression that failed before the
fix. Automated verification is green; live acceptance is **partially verified**, not
fully cleared. The branch is ready for staging validation, not an unconditional
claim that every public Space works. No full benchmark was run.

## Published stage commits

| Stage | Published SHA | Working checkpoint |
| --- | --- | --- |
| 0 | `0ad01db5de6895b32f285fba1c0a393601d42459` | Baseline inventory and corrected polling fixture |
| 1 | `7069a667cac713c8666581c5d20d5546b3f4f3f8` | Normalized schema, components, defaults and dependency slots |
| 2 | `82cf41a61eda6c6a7ae907722f7ad6ce4177dc0d` | Evidence-based message inference; ambiguous mappings stay manual |
| 3 | `804833e0b0699f33323258147d3d0ec917ae651c` | Typed REQUIRED templates; unresolved values cannot execute |
| 4 | `e901eba1365e0b3ddee37979fff9e9f4229e2898` | Bounded, evidence-selected transport alternative |
| 5 | `712bb05ebc9f70a7b45b55a180ecd99c5e4457cf` | Schema-proven text/files message objects |
| 6 | `c504ae7882bd904a96c7d2b75826e7276d2a8880` | Invocation capability separated from text-suite suitability |
| 7 | `df48d6cb975b52d39d47b1ac9d4418ab66995119` | Complete automated regression matrix |
| 8 fix | `9b7657431b950bdd82bb8fdb5334c7dd99a7113e` | Preserve proven State wire slots; never select File as assistant output |

The final documentation-only checkpoint follows these commits without squashing.

## Live acceptance matrix

| Target | Discovery / public contract | Invocation / conclusion |
| --- | --- | --- |
| First Agent Template (`agents-course/First_agent_template`) | PASS: two-step `log_user_message` → `interact_with_agent` workflow | NOT VERIFIED: proxy submit timed out at the existing 18-second limit. Earlier probe reached the second submit. Cause is not established; staging recheck required. |
| Frontier (`apodex/frontier-agent-demo`) | PASS: both `_run` and `_run_1` have valid recipes with assistant output 3; ambiguity requires operator choice | PASS through proxy using current connector orchestration: explicitly selected `_run`, HTTP 200, observed response in 28.205 seconds. New recipe includes two schema-proven State slots. Old manual one-input config was not live-verified against this changed public schema. |
| Travel (`TA25-RSA/travel-agent-smolagents-demo`) | PASS: preferences receives message; origin, destination and month are REQUIRED | Template only; no invented values, no new invocation or full benchmark |
| Council (`burtenshaw/karpathy-llm-council`) | PASS: `ask_council`; public queued capability is exposed | PASS public legacy submit/event-SSE completion and BENCHRX extraction replay. Historical 404 is not reproducible; its original cause is not asserted. |
| MCQ (`21f1001682/mcq-top3-solver`) | PASS: question receives message; option_a through option_e are REQUIRED | Template only; no arbitrary options supplied |
| MedGemma (`warshanks/medgemma-4b-it`) | PASS safe fallback: text/files input shape is proven, but live output is unconstrained JSON | `manual_required`, reason `output_mapping_unproven`; no medical inference performed |
| ClinicalFusion (`Alibaba-DAMO-Academy/clinFusion-medical-vlm`) | INCONCLUSIVE: HTTP errors prevented reliable live schema retrieval | Required-image fixture passes; no live success or third-party application failure claimed |
| DeepSeek login-only (`HoddyKi/huihui-ai-DeepSeek-R1-Distill-Qwen-32B-abliterated`) | PASS: only zero-input/output `_check_login_status`; no text interface | No benchmark recipe offered |
| Finance Assistant | Exact Space URL not supplied; single-string predict fixture passes | Live not tested |
| Gemini 2 Web Search | Exact Space URL not supplied; single-string predict fixture passes | Live not tested |

### Method and limits

Native Node DNS resolution is unavailable in this workspace (`ECONNREFUSED`). Live
requests used the configured environment proxy via bounded Python HTTP probes to
fixed public hosts, with redirects disabled and no credentials. Public schemas were
replayed through current discovery code. First Agent and Frontier invocation probes
used current BENCHRX connector orchestration with that proxy transport; Council used
the public submit/SSE contract and existing parser/extractor.

These are **not** deployed Vercel `/api/connections/test` end-to-end tests and do not
live-verify production DNS pinning. No production networking protection was bypassed
or modified. Pinning/security assertions remain covered by automated tests. No raw
prompts, answers, upstream default values or credentials are included in this report.

## Final automated verification

| Command | Result |
| --- | --- |
| `node --experimental-strip-types --test tests/gradio-*.test.ts tests/connector-normalization.test.ts tests/connectors.test.ts` | 65 passed, 0 failed |
| `npm test` | 81 passed, 0 failed |
| `npm run typecheck` | PASS |
| `npm run build` | PASS on final production code |
| `python3 scripts/verify-worker-sync.py` | PASS: 29 files verified |
| `git diff --check` | PASS |
| `cd worker && python3 -m pytest -q` | BLOCKED: pytest unavailable; dependency installation blocked in this environment. Not a Python pass. |

The final documentation checkpoint repeats the focused tests. Existing auth, SSRF,
connector normalization and Gradio extraction tests are included in the Node suite.
See [the regression matrix](GRADIO-REGRESSION-MATRIX.md) for the 18 requested fixture
categories and [the stage inventory](GRADIO-SCHEMA-STAGES.md) for intermediate results.

## Changed files and architecture

Production files:

- `lib/connectors/types.ts`: normalized parameter, dependency, capability and recipe metadata.
- `lib/server/connectors/gradio-schema.ts`: bounded schema/graph normalization.
- `lib/server/connectors/gradio-input.ts`: shared message inference and sensitive-input exclusions.
- `lib/server/connectors/gradio-message-shape.ts`: conservative standard text/files object recognition.
- `lib/server/connectors/gradio-compatibility.ts`: separate invocation and text-suite signals.
- `lib/server/connectors/gradio-transport.ts`: public-evidence-selected alternative transport.
- `lib/server/connectors/gradio-discovery.ts`: defaults, templates, output selection and proven wire-slot mapping.
- `lib/server/connectors/gradio-chaining.ts`: reuse message inference in existing supported stateful chain.
- `lib/server/gradio-workflow.ts`: unresolved-template execution guard and bounded transport selection.

Tests added or adjusted:
`tests/gradio-6-queue-fallback.test.ts`, `tests/gradio-compatibility.test.ts`,
`tests/gradio-input.test.ts`, `tests/gradio-invocation.test.ts`,
`tests/gradio-message-shape.test.ts`, `tests/gradio-output-label-mapping.test.ts`,
`tests/gradio-regression-matrix.test.ts`, `tests/gradio-schema.test.ts`,
`tests/gradio-templates.test.ts`, `tests/gradio-transport.test.ts`.

Documentation: this report, `GRADIO-SCHEMA-STAGES.md`, `GRADIO-REGRESSION-MATRIX.md`.
The existing connector interface, executor and assistant-only normalizer remain in
place; the new modules supply schema evidence and validated recipes to them.

## Supported and deliberately unsupported patterns

Supported: simple string endpoints; multi-output assistant selection; declared safe
defaults; operator-completed structured templates; proven text/files message objects
with no uploads; existing manual workflows and the known two-step shared-State chain;
proven State wire positions; legacy event-specific SSE and evidence-supported named
v2/shared-session queue alternatives. Explicit completion remains required.

Not automatically supported: arbitrary workflow graphs; unknown object shapes;
unproven JSON assistant outputs; required media fixtures; private/authenticated Space
discovery; missing required operator values; ambiguous endpoint/message/output choices;
helper-only apps; transport variants without adequate public evidence. These remain
manual or rejected rather than receiving fabricated data or speculative retries.

## Security, scoring and remaining validation

Inspection found no Space-specific production branches, new raw-response logging,
scoring/readiness changes or changes to auth, RLS, worker execution or pinned HTTPS.
Sensitive defaults remain redacted; unresolved templates cannot execute. Alternative
transport selection does not follow remote routing URLs or retry every protocol.
No new unresolved security issue was demonstrated; this is not a fresh full security audit.

Deferred, as requested: target-side dependency/model errors returned as ordinary text
(reported Finance `model_not_found` and retired Gemini model cases) still require a
future evidence-based distinction from genuine behavioural responses. Scoring was
not changed to reinterpret these texts.

Before declaring full live acceptance: retest First Agent through staging, run deployed
connection tests including Frontier, obtain reliable ClinicalFusion metadata, supply
the exact Finance/Gemini URLs if those live checks are required, and rerun Python tests
in a provisioned environment. Do not classify proxy timeouts as proven agent failures.

Protected branch heads remained unchanged throughout this task:
`main` = `df22faf5f4cfbf895c34da79001f05dd73ae10b0`;
`feature/generic-connector-reliability` = `529f86c3494181e7e9fb85fb562971c37d034de0`.
No merge was performed.
