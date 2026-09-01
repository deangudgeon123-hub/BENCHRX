import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const targetUrl = String(body.targetUrl ?? "").trim();
    const requestPath = String(body.requestPath ?? "message").trim();
    const responsePath = String(body.responsePath ?? "response").trim();

    if (!targetUrl) {
      return NextResponse.json({ error: "Target URL is required." }, { status: 400 });
    }

    const origin = new URL(request.url).origin;
    const adapter = new URL("/api/adapters/generic", origin);
    adapter.searchParams.set("target", targetUrl);
    adapter.searchParams.set("requestPath", requestPath || "message");
    adapter.searchParams.set("responsePath", responsePath || "response");

    const response = await fetch(adapter, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
