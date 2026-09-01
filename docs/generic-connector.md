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
