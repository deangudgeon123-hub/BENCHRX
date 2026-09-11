import { requireOperator, readBoundedJson, appOrigin } from "@/lib/server/access";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 150;

export async function POST(request: Request) {
  const denied = requireOperator(request);
  if (denied) return denied;
  try {
    const body = await readBoundedJson(request);
    const connectionType = String(body.connectionType ?? "custom").trim().toLowerCase();
    const origin = appOrigin();

    let adapter: URL;
    if (connectionType === "gradio") {
      const spaceUrl = String(body.spaceUrl ?? "").trim();
      const apiName = String(body.apiName ?? "chat").trim();
      const gradioInputs = String(body.gradioInputs ?? "[]").trim() || "[]";
      const outputIndex = String(body.outputIndex ?? "0").trim() || "0";

      if (!spaceUrl) {
        return NextResponse.json({ error: "Gradio Space URL is required." }, { status: 400 });
      }

      adapter = new URL("/api/adapters/gradio", origin);
      adapter.searchParams.set("space", spaceUrl);
      adapter.searchParams.set("apiName", apiName);
      adapter.searchParams.set("inputs", gradioInputs);
      adapter.searchParams.set("outputIndex", outputIndex);
    } else {
      const targetUrl = String(body.targetUrl ?? "").trim();
      const requestPath = String(body.requestPath ?? "message").trim();
      const responsePath = String(body.responsePath ?? "response").trim();
      const fixedBody = String(body.fixedBody ?? "{}").trim() || "{}";

      if (!targetUrl) {
        return NextResponse.json({ error: "Target URL is required." }, { status: 400 });
      }

      adapter = new URL("/api/adapters/generic", origin);
      adapter.searchParams.set("target", targetUrl);
      adapter.searchParams.set("requestPath", requestPath || "message");
      adapter.searchParams.set("responsePath", responsePath || "response");
      adapter.searchParams.set("fixedBody", fixedBody);
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.BENCHRX_ADAPTER_SECRET ?? ""}`,
    };

    const protectionBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    if (protectionBypass) {
      headers["x-vercel-protection-bypass"] = protectionBypass;
    }

    const connectorConfig = Object.fromEntries(adapter.searchParams);
    adapter.search = "";

    let response: Response;
    try {
      response = await fetch(adapter, {
        method: "POST",
        headers,
        body: JSON.stringify({
          _benchrx_config: connectorConfig,
          message: "Reply briefly to confirm this BENCHRX connection test was received.",
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(connectionType === "gradio" ? 135000 : 65000),
        redirect: "error",
      });
    } catch (error) {
      console.error("BENCHRX connection adapter fetch failed", {
        stage: "adapter_request",
        code: "fetch_failed",
      });
      throw error;
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      console.error("BENCHRX connection adapter returned error", {
        stage: "adapter_response",
        code: "http_error",
        status: response.status,
        payloadType: payload === null ? "null" : Array.isArray(payload) ? "array" : typeof payload,
      });
      return NextResponse.json({ error: "Connection test failed." }, { status: response.status });
    }

    return NextResponse.json({
      ok: true,
      response: "Connection succeeded; response content is retained privately.",
    });
  } catch {
    // Parser/transport exceptions can contain request excerpts or secrets.
    // Log only fixed diagnostics, never exception or upstream payload strings.
    console.error("BENCHRX connection test failed", {
      stage: "connection_test",
      code: "request_failed",
    });
    return NextResponse.json({ error: "Connection test failed." }, { status: 500 });
  }
}
