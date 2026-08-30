import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const agentId = url.searchParams.get("id")?.trim();

    if (!agentId) {
      return NextResponse.json(
        { error: "Missing Storkie agent id. Use ?id=YOUR_AGENT_ID" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const message = typeof body?.message === "string" ? body.message.trim() : "";

    if (!message) {
      return NextResponse.json(
        { error: "message is required" },
        { status: 400 }
      );
    }

    const response = await fetch("https://storkie.ai/api/agents/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: agentId,
        message,
      }),
      cache: "no-store",
    });

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = { text: await response.text() };
    }

    if (!response.ok) {
      return NextResponse.json(
        {
          error: "Storkie request failed",
          upstreamStatus: response.status,
          upstream: payload,
        },
        { status: response.status }
      );
    }

    const reply =
      payload && typeof payload === "object" && "reply" in payload
        ? (payload as { reply?: unknown }).reply
        : null;

    if (typeof reply !== "string" || !reply.trim()) {
      return NextResponse.json(
        { error: "Storkie returned no usable reply", upstream: payload },
        { status: 502 }
      );
    }

    return NextResponse.json({
      response: reply.trim(),
      provider: "storkie",
      agentId,
    });
  } catch (error) {
    console.error("Storkie adapter failed", error);
    return NextResponse.json({ error: "Storkie adapter failed" }, { status: 500 });
  }
}
