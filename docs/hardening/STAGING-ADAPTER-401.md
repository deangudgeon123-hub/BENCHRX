# FrontierAgent staging 401 diagnosis — 8 September 2026

## Confirmed evidence

- The branch alias supplied in the report resolves to ready Vercel deployment `dpl_3oVxGYvpbgtzYwJ4py77HfMLpKmg`, commit `0a3ea658e09f98248e0e54254fcac5cba7b90b4b`, on the hardening branch. Its immutable deployment hostname is different from the branch alias, as expected; the worker does not substitute that hostname.
- An unauthenticated POST to that alias's Gradio adapter returns HTTP 401 with `error.message = "Protected deployment"` and `protection.vercel_auth_enabled = true`. Authenticated access through the Vercel integration reaches the Gradio route (GET returns 405 because the route only supports POST).
- Read-only inspection of **BENCHRX Staging** run `1d3999aa-eec4-4c29-a1de-13ef901b0b48` found 31 results with HTTP 401. All 27 behavioural results contain that same Vercel protection JSON. Zero results contain BENCHRX's plain `Unauthorized` response.
- Render `/health` reports worker version 0.7.0 and suite 2.0. Health does not expose a commit ID or effective authentication settings. The Render connector requires a user-selected workspace, so the live worker commit and environment values could not be inspected.

**The observed rejection is at Vercel deployment protection, before BENCHRX adapter authentication.** No valid deployment-protection credential was accepted on those worker requests. These observations do not distinguish a missing token from an invalid/revoked token, a stale deployment environment, or older deployed worker code. The exact live Render token state remains unverified.

## Request trace

1. `worker/services/agent_client.py` matches the supplied HTTPS origin and `/api/adapters/gradio` path. Its allowlist strips surrounding whitespace and trailing slashes; the exact reported values match.
2. For that trusted URL, it attaches `Authorization: Bearer <BENCHRX_ADAPTER_SECRET>` and, if configured, `x-vercel-protection-bypass: <VERCEL_AUTOMATION_BYPASS_SECRET>`.
3. Only **after** constructing headers does it move the query configuration into `_benchrx_config` and remove the query from the request URL. The origin/path do not change. Redirects are not followed; no automatic alias/deployment-host replacement occurs.
4. The pinned HTTP transport forwards the request headers through HTTPCore. Regression coverage now checks the serialized HTTP headers, original TLS hostname and numeric pinned connection, in addition to the exact reported URL.
5. Vercel's connection-test route runs inside Vercel and explicitly includes its own automation-bypass environment variable. A successful connection test therefore does not verify Render's separately configured bypass token.

The two secrets serve different gates. `BENCHRX_ADAPTER_SECRET` cannot satisfy Vercel Authentication. `BENCHRX_ADAPTER_ORIGINS` only authorizes where the worker may send secrets; it does not grant deployment access.

## Configuration fix

1. In this Vercel project's **Settings → Deployment Protection → Protection Bypass for Automation**, obtain a valid project bypass secret. Do not disable deployment protection.
2. Set `VERCEL_AUTOMATION_BYPASS_SECRET` on the **Render staging worker** to that valid project secret. It is separate from `BENCHRX_ADAPTER_SECRET`; do not paste either value into logs, tickets or chat.
3. Restart/redeploy the staging worker so its process loads the environment. The current worker reads the bypass variable at import/startup. If the Vercel bypass secret was regenerated, redeploy the Vercel preview too so its connection-test flow uses the valid value.
4. Keep the exact branch alias in `BENCHRX_ADAPTER_ORIGINS`. Do not broaden the allowlist to all Vercel domains or send bypass credentials to the Hugging Face endpoint.
5. Run one staging benchmark and verify the behavioural attempts reach an authored response instead of Vercel's protection response. A passing connection test alone is not this verification. Do not rerate the old run; its withheld score remains correct.

Whitespace: the worker strips whitespace around origin entries and its bypass secret, but not the adapter secret. Embedded CR/LF in a header value can cause a transport error. A normal HTTP 401 containing Vercel protection JSON is not evidence of an adapter-secret whitespace mismatch. Check effective deployed environments without exposing their values; do not silently rewrite credentials to conceal configuration errors.

## Scope

No runtime authentication or scoring logic was changed: the existing header path is correct for the supplied configuration. This commit adds exact-endpoint, independent-gate and pinned-wire regression tests, plus these configuration instructions. No database writes, environment changes, deployments, production-branch changes or old Render-branch changes were performed. Live resolution still requires the staging environment correction and rerun above.

Reference: https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation
