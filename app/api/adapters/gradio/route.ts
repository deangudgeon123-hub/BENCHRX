import {requireAdapter, readBoundedJson, adapterConfig} from "@/lib/server/access";
import {invokeConnector} from "@/lib/server/connectors/interface";
import {gradioConnector} from "@/lib/server/connectors/gradio";
import {NextResponse} from "next/server";
export const runtime = "nodejs";
export const maxDuration = 150;

export async function POST(request: Request) {
  const denied = requireAdapter(request);
  if (denied) return denied;
  try {
    const incoming = await readBoundedJson(request);
    const reply = await invokeConnector(gradioConnector, adapterConfig(incoming), incoming);
    return NextResponse.json(reply.body, {status: reply.status});
  } catch {
    // Never log endpoint URLs, credentials, raw output, or remote exception strings.
    console.error("Connector execution failed");
    return NextResponse.json({error: "Connector execution failed"}, {status: 502});
  }
}
