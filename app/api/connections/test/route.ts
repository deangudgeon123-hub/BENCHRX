import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const connectionType = String(body.connectionType ?? "custom").trim().toLowerCase();
    const origin = new URL(request.url).origin;

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
    };

    const protectionBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    if (protectionBypass) {
      headers["x-vercel-protection-bypass"] = protectionBypass;
    }

    const response = await fetch(adapter, {
      method: "POST",
      headers,
      body: JSON.stringify({
        message: "Reply briefly to confirm this BENCHRX connection test was received.",
      }),
      cache: "no-store",
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const detail =
        payload && typeof payload === "object" && "error" in payload
          ? String((payload as { error?: unknown }).error ?? "Connection test failed.")
          : "Connection test failed.";
      return NextResponse.json({ error: detail }, { status: response.status });
    }

    const agentResponse =
      payload && typeof payload === "object" && "response" in payload
        ? String((payload as { response?: unknown }).response ?? "")
        : "";

    return NextResponse.json({
      ok: true,
      response: agentResponse,
    });
  } catch (error) {
    console.error("Connection test failed", error);
    return NextResponse.json({ error: "Connection test failed." }, { status: 500 });
  }
}
