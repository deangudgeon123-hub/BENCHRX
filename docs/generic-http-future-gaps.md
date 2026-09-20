# Generic HTTP connector: remaining gaps

The existing **Custom HTTP API** connector remains BENCHRX's general-purpose JSON/HTTPS integration. It already supports configurable public HTTPS targets, request and response JSON paths, fixed request JSON, nested object/array paths, and BENCHRX's existing network protections.

No Generic HTTP behaviour is changed by this note. The first-class A2A, LangGraph, and OpenAI Agents connectors should remain separate providers rather than being folded back into Generic HTTP.

## Useful future improvements

These are intentionally deferred and should only be implemented when there is a concrete compatibility need:

- **Custom Authorization and headers** — allow approved request headers without exposing credentials in URLs, logs, public database fields, or client-visible responses. This requires an appropriate private credential-storage path before secret-bearing headers are enabled.
- **cURL import** — parse a user-supplied cURL example into the existing target, method, fixed JSON, request path, response path, and safe header configuration. Imported URLs must still pass the normal HTTPS/public-network validation.
- **SSE responses** — support bounded server-sent-event responses with explicit terminal detection, timeout handling, response-size limits, and fail-closed behaviour for incomplete streams.
- **Async start / poll / result workflows** — support APIs that return a job/run identifier and require bounded polling before fetching the final assistant-authored result. Transport state must remain trusted local metadata; remote response content must not determine observed transport status.

## Invariants for future work

Any future Generic HTTP expansion must preserve the existing SSRF/public-network protections, HTTPS requirements, bounded requests/responses, trusted transport classification, and normalized connector outcomes. Assistant output extraction must remain separate from transport success, and remote response fields must never be allowed to manufacture BENCHRX observation evidence.

Gradio-specific expansion and MCP support are outside this review.
