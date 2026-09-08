import {requireAdapter,readBoundedJson,adapterConfig} from "@/lib/server/access";
import {extractAssistantText} from "@/lib/server/gradio-output";
import {parsePlan,executeGradioPlan} from "@/lib/server/gradio-workflow";
import {validateAndPinPublicHttpsUrl} from "@/lib/server/pinned-https";
import {NextResponse} from "next/server";
export const runtime="nodejs";
export const maxDuration=60;

export async function POST(request: Request) {
  const denied = requireAdapter(request);
  if (denied) return denied;
  try {
    const incoming = await readBoundedJson(request);
    const config = adapterConfig(incoming);
    const space = await validateAndPinPublicHttpsUrl(
      config.get("space")?.trim() ?? "",
      {
        invalidUrlMessage: "Enter a valid Gradio Space URL.",
        httpsRequiredMessage: "Gradio Space endpoints must use HTTPS.",
      }
    );

    const plan = parsePlan(
      config.get("inputs") ?? "[]",
      config.get("apiName") ?? "chat",
      config.get("outputIndex") ?? "0"
    );

    const hasMessage =
      incoming &&
      typeof incoming === "object" &&
      Object.prototype.hasOwnProperty.call(incoming, "message");
    const message = hasMessage ? (incoming as { message?: unknown }).message : undefined;

    const selectedResults=await executeGradioPlan(space,plan,message);

    const finalStep = plan.steps[plan.finalStepIndex];
    const finalValue = selectedResults[plan.finalStepIndex];
    const responseText = extractAssistantText(finalValue);

    if (!responseText) {
      return NextResponse.json(
        {
          error: "Gradio completed but BENCHRX could not extract a text response.",
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      response: responseText,
      provider: "gradio",
      targetHost: space.hostname,
      apiName: finalStep.apiName,
      workflowSteps: plan.steps.length,
      clientMode: "pinned",
    });
  } catch (error) {
    console.error("Connector request failed");
    return NextResponse.json({ error: "Connector execution failed" }, { status: 502 });
  }
}
