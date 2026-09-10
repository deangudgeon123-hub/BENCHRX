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
