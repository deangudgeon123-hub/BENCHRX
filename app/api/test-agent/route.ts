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
