# BENCHRX Generic Connector v1

The generic connector lets BENCHRX test public synchronous JSON agent APIs without a platform-specific adapter.

## Supported shape

- HTTPS only
- POST requests
- JSON request bodies
- Public unauthenticated endpoints
- Dot-separated request paths such as `message` or `input.message`
- Dot-separated response paths such as `response` or `result.answer`

BENCHRX normalizes the external API to its internal contract:

```json
{ "message": "..." }
```

and expects the configured upstream response path to resolve to a non-empty string.

## Safety constraints

The generic adapter rejects local/private hostnames and private/link-local IP ranges, resolves hostnames before connecting, does not follow redirects, enforces a request timeout, and caps upstream response size.

This is intentionally a narrow v1. Authenticated endpoints, custom headers, async run/thread APIs, webhooks and tool-session protocols should be added separately rather than putting credentials into URLs or public scorecard data.
