import {isRuntimeConnector, runtimeEndpoint} from "@/lib/server/connectors/runtime-config";
import { readBoundedJson, appOrigin } from "@/lib/server/access";
import {preflightConnection} from "@/lib/server/connection-preflight";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 150;

export async function POST(request: Request) {
  try {
    const body = await readBoundedJson(request);
    const connectionType = String(body.connectionType ?? "custom").trim().toLowerCase();
    const origin = appOrigin();

    let adapter: URL;
    if (connectionType === "native") {
      adapter = new URL(String(body.endpointUrl ?? "").trim());
    } else if (isRuntimeConnector(connectionType)) {
      adapter = runtimeEndpoint({...body, connectionType}, origin);
    } else if (connectionType === "gradio") {
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

    const result = await preflightConnection(adapter.href);
    if (!result.ok) return NextResponse.json({error: "Connection test failed.", ...(result.diagnostics ? {diagnostics:result.diagnostics} : {})}, {status:result.status});

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
