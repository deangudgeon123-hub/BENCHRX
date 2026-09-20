import {requireAdapter, readBoundedJson, adapterConfig} from "@/lib/server/access";
import {invokeConnector} from "@/lib/server/connectors/interface";
import {langGraphConnector} from "@/lib/server/connectors/langgraph";
import {NextResponse} from "next/server";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function POST(request: Request) {
  const denied = requireAdapter(request);
  if (denied) return denied;
  try {
    const incoming = await readBoundedJson(request);
    const reply = await invokeConnector(langGraphConnector, adapterConfig(incoming), incoming);
    return NextResponse.json(reply.body, {status: reply.status});
  } catch {
    console.error("LangGraph connector execution failed");
    return NextResponse.json({error: "Connector execution failed"}, {status: 502});
  }
}
