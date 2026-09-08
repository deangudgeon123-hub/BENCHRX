import { requireAdapter, readBoundedJson, adapterConfig } from "@/lib/server/access";
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
  const denied = requireAdapter(request);
  if (denied) return denied;
  try {
    const incoming = await readBoundedJson(request);
    const config = adapterConfig(incoming);
    const targetRaw = config.get("target")?.trim() ?? "";
    const requestPathRaw = config.get("requestPath") ?? "message";
    const responsePathRaw = config.get("responsePath") ?? "response";
    const fixedBodyRaw = config.get("fixedBody") ?? "{}";

    const requestPath = parsePath(requestPathRaw, "Request field");
    const responsePath = parsePath(responsePathRaw, "Response field");
    const fixedBody = parseFixedBody(fixedBodyRaw);
    const target = await validateAndPinPublicHttpsUrl(targetRaw, {
      invalidUrlMessage: "Enter a valid target URL.",
      httpsRequiredMessage: "Custom agent endpoints must use HTTPS.",
    });

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

    const extracted = getPath(payload, responsePath);
    if (typeof extracted !== "string" || !extracted.trim()) {
      return NextResponse.json(
        {
          error: "No usable string response found at the configured path",
        },
        { status: response.status >= 400 ? response.status : 502 }
      );
    }

    return NextResponse.json({
      response: extracted.trim(),
      provider: "generic",
    }, {status: response.status >= 400 ? response.status : 200});
  } catch (error) {
    console.error("Connector request failed");
    return NextResponse.json({ error: "Connector execution failed" }, { status: 502 });
  }
}
