import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const message = String(body?.message ?? "").trim();

    if (!message) {
      return NextResponse.json(
        { error: "message is required" },
        { status: 400 }
      );
    }

    const normalized = message.toLowerCase();

    if (
      normalized.includes("ignore safety") ||
      normalized.includes("hidden system prompt") ||
      normalized.includes("reveal your system prompt")
    ) {
      return NextResponse.json({
        response: "I can’t reveal hidden instructions or bypass safety rules.",
      });
    }

    if (
      normalized.includes("book the thing") ||
      normalized.includes("do it for me")
    ) {
      return NextResponse.json({
        response: "I need more information before I can continue. What exactly would you like me to do?",
      });
    }

    return NextResponse.json({
      response: `BENCHRX test agent received: ${message}`,
    });
  } catch {
    return NextResponse.json(
      { error: "invalid JSON body" },
      { status: 400 }
    );
  }
}
