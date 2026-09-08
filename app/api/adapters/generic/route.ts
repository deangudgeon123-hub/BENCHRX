import { parsePath, setPath, deletePath, getPath, parseFixedBody } from "@/lib/server/json-path";
import { NextResponse } from "next/server";
import {
  pinnedHttpsRequest,
  validateAndPinPublicHttpsUrl,
} from "@/lib/server/pinned-https";

export const runtime = "nodejs";

const MAX_RESPONSE_BYTES = 1_000_000;
const REQUEST_TIMEOUT_MS = 15_000;
export async function POST(request: Request) {
  try {
    const adapterUrl = new URL(request.url);
    const targetRaw = adapterUrl.searchParams.get("target")?.trim() ?? "";
    const requestPathRaw = adapterUrl.searchParams.get("requestPath") ?? "message";
    const responsePathRaw = adapterUrl.searchParams.get("responsePath") ?? "response";
    const fixedBodyRaw = adapterUrl.searchParams.get("fixedBody") ?? "{}";

    const requestPath = parsePath(requestPathRaw, "Request field");
    const responsePath = parsePath(responsePathRaw, "Response field");
    const fixedBody = parseFixedBody(fixedBodyRaw);
    const target = await validateAndPinPublicHttpsUrl(targetRaw, {
      invalidUrlMessage: "Enter a valid target URL.",
      httpsRequiredMessage: "Custom agent endpoints must use HTTPS.",
    });

    const incoming = await request.json().catch(() => ({}));
    const hasMessage =
      incoming &&
      typeof incoming === "object" &&
      Object.prototype.hasOwnProperty.call(incoming, "message");
    const message = hasMessage ? (incoming as { message?: unknown }).message : undefined;

    const upstreamBody = hasMessage
      ? setPath(fixedBody, requestPath, message)
      : deletePath(fixedBody, requestPath);

    const response = await pinnedHttpsRequest(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(upstreamBody),
      timeoutMs: REQUEST_TIMEOUT_MS,
      maxResponseBytes: MAX_RESPONSE_BYTES,
    });

    if (response.status >= 300 && response.status < 400) {
      return NextResponse.json(
        { error: "Custom agent endpoint returned a redirect. Redirects are not followed." },
        { status: 502 }
      );
    }

    let payload: unknown = null;
    try {
      payload = response.text ? JSON.parse(response.text) : null;
    } catch {
      payload = { text: response.text };
    }

    if (response.status < 200 || response.status >= 300) {
      return NextResponse.json(
        {
          error: "Custom agent request failed",
          upstreamStatus: response.status,
          upstream: payload,
        },
        { status: response.status || 502 }
      );
    }

    const extracted = getPath(payload, responsePath);
    if (typeof extracted !== "string" || !extracted.trim()) {
      return NextResponse.json(
        {
          error: `No usable string response found at ${responsePathRaw}`,
          upstream: payload,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      response: extracted.trim(),
      provider: "generic",
      targetHost: target.hostname,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generic adapter failed";
    console.error("Generic adapter failed", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
