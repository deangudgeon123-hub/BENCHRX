# Schema-driven Gradio checkpoints

## Stage 0: baseline at 12495c5 (2026-09-10)

- Normalized endpoints currently contain API name, visible input/output arrays and
  counts, name/type/component/safe-default metadata, and an endpoint-name hint.
- Discovery selects string inputs using two separate name heuristics. Structured
  templates cover string-only required values. Multiple plausible inputs stay manual.
- `/config` currently enriches generated output names and proves the known two-step
  stateful dependency chain. Hidden State positions and visible output indices differ.
- Invocation starts with `/gradio_api/call/{api_name}`. A single-step submit 404 can
  trigger info-based v2 named submission and then config-based queue submission.
  Stage 4 must replace speculative fallback decisions with capability evidence.
- Single-step polling uses an event-specific result URL; workflows and queue submits
  use session queue polling. Each invocation owns fresh session state. Workflow
  deadline is 125 seconds; submit requests are capped at 18 seconds.
- Extraction requires completed SSE and assistant-authored output. Chatbot messages,
  tuples and Frontier Markdown transcripts are supported; user-only and Working
  placeholders are not final responses. Selected output indices remain explicit.
- Defaults are filtered before serialization; arbitrary text, examples and raw schema
  descriptions are not exposed. Stage 3 will test sensitive/typed defaults and enforce
  that unresolved REQUIRED templates cannot be invoked.
- Existing fixtures cover First Agent shared state, Frontier single-input/output 3,
  Travel preferences mapping, simple predict-style text agents (the Finance/Gemini
  shape), generic HTTP, ambiguous discovery, SSE completion, redaction and pinning.
  These are compatibility commitments, not fresh live-success claims.

Baseline: 37/38 focused tests passed. The failing v2 fixture required a different
GET route than production. Gradio 6.20.0 `routes.py` registers both
`/call/v2/{api_name}/{event_id}` and `/call/{api_name}/{event_id}` on
`simple_predict_get`; corrected the fixture without changing production behaviour.
Verified source: https://github.com/gradio-app/gradio/blob/gradio%406.20.0/gradio/routes.py

Deferred scoring issue: Finance/Gemini model/dependency failures may arrive as ordinary
successful Gradio text outputs. This task must not reinterpret them or change scoring.

## Stage 1: additive schema/capability normalization

Parameters now distinguish required/optional/unknown and absent/safe/redacted defaults.
Only safe values survive serialization. Capability candidates do not claim invocation
success or benchmark suitability. When config is already available, bounded graph
normalization preserves State slots, wire indices, visible indices and dependencies
without changing recipe selection, requests, deadlines or output extraction.

Verification: 42 focused tests pass; typecheck and production build pass. Added tests
cover safe-default metadata, State visibility/arity, duplicate/incomplete graph handling,
multi-output capability candidates, malformed schemas and unchanged recipe generation.

## Stage 2: evidence-based text input inference

Single and structured discovery now share one inference function with the established
stateful chain. Eligible inputs must be free-text controls with string schema types;
credential/configuration fields cannot win by name, label or sole-string fallback.
Semantic roles are evaluated together: competing prompt/context/task fields stay
ambiguous. A sole unnamed text input is accepted only on an agent-shaped endpoint.
MCQ maps question and leaves every option REQUIRED; Travel still maps preferences.

Verification: 47 focused tests, typecheck and production build pass. No transport,
scoring, extraction, timeout or security-network changes. Enforcing unresolved template
rejection and typed fixed-input requirements belongs to the next checkpoint (Stage 3).

## Stage 3: typed templates and execution guard

Non-message parameters now use declared safe defaults or explicit REQUIRED values,
including numeric, object, array and file inputs. Recipes carry executable/template
kind plus required-input type metadata. Template structural validation is separate
from executable-plan validation; execution itself also rejects unresolved nested
values, so a template cannot bypass the guard by being parsed through the template API.
No values or multimodal fixtures are invented. Recognizing a file input does not yet
claim current-suite suitability (Stage 6).

Default filtering now checks sensitive names/labels before primitive shortcuts,
recognizes spaced API-key labels, bounds selector strings, and checks declared schema
type compatibility. This closes a verified primitive/label redaction gap without
changing credential handling or the security architecture.

Verification: 51 focused tests, all 67 Node tests, typecheck and production build pass.
Transport, scoring, readiness, benchmark content, worker and database files are untouched.

## Stage 4: public transport capabilities

Council live check (2026-09-10): `/info` advertises public ask_council; `/config`
declares a public queued function id 3, sse_v3 and /gradio_api prefix. `/openapi.json`
returns HTML, not routing evidence. The current legacy submit returned 200 with a valid
event ID; polling completed and existing extraction found assistant text. The reported
historical 404 is not reproducible, so its cause is not asserted. Probes used the fixed
public Space via the environment proxy; production pinned DNS is unavailable in this
workspace. This is not a deployed Vercel connection-test claim.

Removed speculative fallback ordering. After a single-step legacy 404, named v2 is
eligible only when the endpoint's public API snippet explicitly advertises it and
parameter names/arity validate. Otherwise a public queued capability requires matching
info/config visibility, prefix, protocol, queue flag, input arity and function ID.
At most one alternative is submitted. Its 404/500/etc. cannot trigger another job.
Neither versions nor remote URLs control routing; all requests retain the pinned host.
Unsafe/duplicate named keys are rejected. Existing successful legacy/session paths remain.

Verification: 55 focused tests, typecheck and production build pass. Regression cases
include no retry on auth/429/500/redirect errors, unsupported 404, failed alternative,
private/ambiguous queue metadata, named v2, and existing First Agent/Frontier paths.

## Stage 5: schema-proven object inputs

Public MedGemma info proves MultimodalTextbox/MultimodalData with text:string and
files:array. Added a conservative recognizer that emits text plus an empty files array;
unknown objects, extra constraints or required uploads remain manual. No file uploads,
arbitrary role/content guesses or multimodal scoring were added. Normal string inputs
retain their old payload. Other input defaults must still be declared and safe.

The live MedGemma output is currently JSON with an unconstrained type, not the string
output in the task's reference description. Its input is recognized, but full discovery
correctly remains manual because assistant output mapping is unproven. No live medical
inference was run. Public output/default/description content is not copied to diagnostics.

Numeric generation limits (e.g. a declared Max New Tokens Slider) are distinguished
from credential tokens using numeric schema plus exact control name/label evidence.
Credential names cannot acquire that exception through a spoofed label.

Verification: 58 focused tests, typecheck and production build pass. Live schema replay
recognizes the input shape and preserves the unproven-output manual fallback.

## Stage 6: invocation versus text-suite capability

Discovery now records independent invocation and text-suite signals with fixed reason
codes. Schema-valid endpoints requiring media remain visible but produce no automatic
benchmark recipe. Zero-input/output helpers have no text interface. Unresolved static
inputs are templates; executable text interfaces are candidates, not claims of purpose
fit or successful invocation. Known stateful recipes retain their proven wiring.
No scoring, media fixtures, UI secrets or benchmark runner changes were introduced.

Verification: 61 focused tests, typecheck and production build pass.

## Stage 7: complete regression matrix

See GRADIO-REGRESSION-MATRIX.md for all 18 requested fixture categories and commands.
Added explicit malformed event-ID/submit-JSON coverage. All 79 Node tests, typecheck,
production build and 29 worker hashes pass. Python verification is environment-blocked
(missing pytest; dependency installation unavailable), not a claimed pass.
Cumulative diff inspection found no unrelated changes, new raw logging, secrets,
Space-specific runtime dispatch, scoring changes or security-architecture changes.

## Stage 8a: generic fix proven by live schema replay

Frontier's public surface revealed a pre-existing array-output heuristic bug: an
explicit File component labelled Output files could win the fallback intended only
for schemas missing Chatbot component metadata. That fallback now requires missing
component metadata. A uniquely labelled Current turn Markdown transcript is recognized
as a current assistant-output candidate; extraction still requires assistant-authored
content. Current live Frontier selects output 3, not its file output at 4.

The same public graph proves two hidden State inputs. Generated single-step/structured
recipes now map visible inputs/outputs to normalized wire slots, inserting null only
for proven State slots. This is the same server-State placeholder rule as the existing
First Agent workflow. Manual configs and transport internals are unchanged.

A new live-shape regression failed before the fix (selected 4 instead of 3).
Verification after the fix: 65 focused tests, all 81 Node tests, typecheck and production
build pass. No live timeout budget was increased to accommodate the workspace proxy.
