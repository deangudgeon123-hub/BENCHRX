# A2A connector

Select A2A in the benchmark Connection section and enter an agent origin or explicit
Agent Card URL. Test Connection and benchmark runs discover
`/.well-known/agent-card.json`, choose JSON-RPC or HTTP+JSON, independently validate and pin the
advertised endpoint, and invoke it through the authenticated BENCHRX adapter.

Supported: A2A 0.3 and 1.0 JSON-RPC/HTTP+JSON, blocking message execution, and SSE when the
card advertises it. Artifact chunks are accumulated by artifact ID; only completed
tasks or direct agent-authored messages yield text. Failed, interrupted, truncated,
or mismatched-task streams cannot yield an observed response. Discovery has an
8-second HTTP deadline; invocation has a 30-second HTTP deadline and 1 MB limit.
HTTP status comes from the pinned transport; agent text/flags never override it.

Not supported yet: gRPC binding, required extensions, authentication,
push callbacks, asynchronous polling after a nonterminal synchronous response,
non-text inputs/outputs. Diagnostics use fixed codes without remote error text.
Credentials must not be embedded in an endpoint or its query string.

References: https://a2a-protocol.org/latest/specification/ and
https://a2a-protocol.org/v0.3.0/specification/.

Checks: `node --experimental-strip-types --test tests/a2a-connector.test.ts`
and `python -m pytest -q worker/tests/test_runtime_adapters.py`.
