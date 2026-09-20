# Generic connectors

BENCHRX currently supports two adapter styles on the feature branch.

## Custom HTTP JSON

Use this for public synchronous JSON endpoints that accept one POST and return one JSON response.

The adapter supports:

- HTTPS-only public targets
- nested request and response paths
- array indexes such as `messages[0].content`
- optional fixed request JSON for fields such as `model` and `role`
- private/local target blocking, redirect blocking, timeout and response-size limits

## Hugging Face / Gradio queue API

Gradio Spaces generally use a two-step queue protocol rather than a single synchronous response. BENCHRX now has `/api/adapters/gradio` for that shape.

The adapter:

1. POSTs `{"data": [...]}` to `/gradio_api/call/{api_name}`
2. reads the returned `event_id`
3. GETs `/gradio_api/call/{api_name}/{event_id}`
4. parses the Server-Sent Events result
5. extracts a useful text response and returns the normal BENCHRX `{ "response": "..." }` contract

Inputs are supplied as a JSON array template. The template must contain the exact string `{{message}}`; BENCHRX replaces that placeholder with each benchmark prompt before submitting the Gradio job. The placeholder can be nested inside objects or arrays.

Example ChatInterface-style configuration:

- Space URL: `https://example-space.hf.space`
- API name: `chat`
- Input JSON: `["{{message}}"]`
- Output index: `0`

Public unauthenticated Spaces only in this first version. Private/local destinations remain blocked. Hugging Face authentication and ZeroGPU quota handling are not included yet.

## Custom HTTP JSON: future gaps

The current Generic HTTP connector intentionally remains a small synchronous JSON adapter: one HTTPS POST, a configurable request JSON path, fixed request JSON, and a configurable string response path. The following are useful future compatibility improvements, not requirements for the A2A, LangGraph, or OpenAI Agents connectors added in this pass:

- **Custom authorization and headers.** Allow explicitly configured headers for APIs that require bearer tokens, API keys, tenant headers, version headers, or non-default content negotiation. Credentials must use a private server-side secret mechanism and must never be placed in endpoint URLs, query parameters, logs, public database fields, or client-visible responses.
- **cURL import.** Parse a pasted cURL request into the existing target, method/header, fixed-body, and JSON-path configuration so users do not have to translate API examples manually. Imported credentials must be detected and moved to the same private secret mechanism rather than persisted in public connector configuration.
- **SSE responses.** Support generic Server-Sent Events with explicit terminal/completion rules, bounded retained data, timeout handling, and assistant-output extraction. Remote event/body content must not be allowed to set trusted transport or observation status.
- **Async start / poll / result workflows.** Support APIs that return a run/job identifier and require subsequent status polling or result retrieval. This should use bounded polling, explicit terminal states, timeout/failure diagnostics, and final assistant-authored result extraction.
- **Additional HTTP shapes where justified.** The current adapter is POST + JSON + string response-path only. Configurable methods or non-JSON response handling can be added later when real integrations demonstrate the need, without weakening the existing HTTPS/public-network protections.

No Generic HTTP behavior is changed by this review. Existing SSRF/public-network protections, redirect blocking, response-size limits, timeouts, JSON-path validation, and trusted observation rules remain the baseline for any future expansion.
