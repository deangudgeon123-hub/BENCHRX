import { requireAdapter, readBoundedJson, adapterConfig } from "@/lib/server/access";
import {pinnedHttpsRequest, validateAndPinPublicHttpsUrl} from "@/lib/server/pinned-https";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const denied = requireAdapter(request);
  if (denied) return denied;
  try {
    const body = await readBoundedJson(request);
    const config = adapterConfig(body);
    const agentId = config.get("id")?.trim();

    if (!agentId) {
      return NextResponse.json(
        { error: "Missing Storkie agent id. Use ?id=YOUR_AGENT_ID" },
        { status: 400 }
      );
    }

    const message = typeof body?.message === "string" ? body.message.trim() : "";

    if (!message) {
      return NextResponse.json(
        { error: "message is required" },
        { status: 400 }
      );
    }

    const target = await validateAndPinPublicHttpsUrl("https://storkie.ai/api/agents/chat", {
      invalidUrlMessage: "Invalid provider URL", httpsRequiredMessage: "HTTPS required",
    });
    const response = await pinnedHttpsRequest(target, {
      method: "POST", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({id:agentId,message}), timeoutMs:18000, maxResponseBytes:1000000,
    });
    let payload: unknown;
    try { payload=JSON.parse(response.text); } catch { payload=null; }
    const reply =
      payload && typeof payload === "object" && "reply" in payload
        ? (payload as { reply?: unknown }).reply
        : null;

    if (typeof reply !== "string" || !reply.trim()) {
      return NextResponse.json(
        { error: "Storkie returned no usable reply" },
        { status: 502 }
      );
    }

    return NextResponse.json({response: reply.trim(), provider: "storkie"}, {status: response.status >= 400 ? response.status : 200});
  } catch (error) {
    console.error("Connector request failed");
    return NextResponse.json({ error: "Storkie adapter failed" }, { status: 500 });
  }
}
