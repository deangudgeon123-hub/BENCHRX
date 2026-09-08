import { parseSseComplete, extractAssistantText } from "@/lib/server/gradio-output";
import { Client } from "@gradio/client";
import { NextResponse } from "next/server";
import {
  pinnedHttpsRequest,
  validateAndPinPublicHttpsUrl,
  type ValidatedHttpsTarget,
} from "@/lib/server/pinned-https";

export const runtime = "nodejs";

const REQUEST_TIMEOUT_MS = 18_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_WORKFLOW_STEPS = 4;

type JsonObject = Record<string, unknown>;

type WorkflowStep = {
  apiName: string;
  inputs: unknown[];
  outputIndex: number;
};

type ParsedPlan = {
  steps: WorkflowStep[];
  finalStepIndex: number;
  isWorkflow: boolean;
};

function withPath(target: ValidatedHttpsTarget, path: string): ValidatedHttpsTarget {
  return {
    ...target,
    url: new URL(path, target.url.origin),
  };
}

function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs} ms.`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function normalizeApiName(raw: string) {
  const apiName = raw.trim().replace(/^\/+/, "");
  if (!apiName || !/^[A-Za-z0-9_.-]+$/.test(apiName)) {
    throw new Error("Enter a valid Gradio API name, for example chat or predict.");
  }
  return apiName;
}

function parseOutputIndex(value: unknown, label: string) {
  const parsed = Number(value ?? 0);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return parsed;
}

function containsMessagePlaceholder(value: unknown): boolean {
  if (value === "{{message}}") return true;
  if (Array.isArray(value)) return value.some(containsMessagePlaceholder);
  if (value && typeof value === "object") {
    return Object.values(value as JsonObject).some(containsMessagePlaceholder);
  }
  return false;
}

function parsePlan(raw: string, apiNameRaw: string, outputIndexRaw: string): ParsedPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "[]");
  } catch {
    throw new Error("Gradio input JSON must be valid JSON.");
  }

  if (Array.isArray(parsed)) {
    if (!containsMessagePlaceholder(parsed)) {
      throw new Error('Gradio input JSON must contain the exact string "{{message}}".');
    }
    return {
      steps: [
        {
          apiName: normalizeApiName(apiNameRaw),
          inputs: parsed,
          outputIndex: parseOutputIndex(outputIndexRaw, "Gradio output index"),
        },
      ],
      finalStepIndex: 0,
      isWorkflow: false,
    };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Gradio input JSON must be an array or workflow object.");
  }

  const object = parsed as JsonObject;
  const rawSteps = object.steps;
  if (!Array.isArray(rawSteps) || rawSteps.length < 1 || rawSteps.length > MAX_WORKFLOW_STEPS) {
    throw new Error(`Gradio workflow must contain 1 to ${MAX_WORKFLOW_STEPS} steps.`);
  }

  const steps = rawSteps.map((rawStep, index) => {
    if (!rawStep || typeof rawStep !== "object" || Array.isArray(rawStep)) {
      throw new Error(`Gradio workflow step ${index + 1} must be an object.`);
    }
    const step = rawStep as JsonObject;
    if (!Array.isArray(step.inputs)) {
      throw new Error(`Gradio workflow step ${index + 1} inputs must be a JSON array.`);
    }
    return {
      apiName: normalizeApiName(String(step.apiName ?? "")),
      inputs: step.inputs,
      outputIndex: parseOutputIndex(step.outputIndex ?? 0, `Workflow step ${index + 1} outputIndex`),
    } satisfies WorkflowStep;
  });

  if (!steps.some((step) => containsMessagePlaceholder(step.inputs))) {
    throw new Error('Gradio workflow must contain the exact string "{{message}}" in at least one step.');
  }

  const finalStepIndex = parseOutputIndex(object.finalStep ?? steps.length - 1, "Gradio finalStep");
  if (finalStepIndex >= steps.length) {
    throw new Error("Gradio finalStep points to a step that does not exist.");
  }

  return { steps, finalStepIndex, isWorkflow: true };
}

function getPath(value: unknown, path: number[]): unknown {
  let cursor = value;
  for (const index of path) {
    if (!Array.isArray(cursor) || index < 0 || index >= cursor.length) return undefined;
    cursor = cursor[index];
  }
  return cursor;
}

function replacePlaceholders(value: unknown, message: unknown, stepResults: unknown[]): unknown {
  if (value === "{{message}}") return message;

  if (typeof value === "string") {
    const match = value.match(/^\{\{step(\d+)((?:\.\d+)*)\}\}$/);
    if (match) {
      const stepIndex = Number(match[1]);
      const path = match[2]
        ? match[2].split(".").filter(Boolean).map((part) => Number(part))
        : [];
      const source = stepResults[stepIndex];
      return path.length ? getPath(source, path) : source;
    }
  }

  if (Array.isArray(value)) {
    return value.map((item) => replacePlaceholders(item, message, stepResults));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonObject).map(([key, item]) => [
        key,
        replacePlaceholders(item, message, stepResults),
      ])
    );
  }

  return value;
}

async function callPinnedSingleStep(
  space: ValidatedHttpsTarget,
  step: WorkflowStep,
  data: unknown[]
) {
  const submitTarget = withPath(space, `/gradio_api/call/${encodeURIComponent(step.apiName)}`);
  const submitResponse = await pinnedHttpsRequest(submitTarget, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data }),
    timeoutMs: REQUEST_TIMEOUT_MS,
    maxResponseBytes: MAX_RESPONSE_BYTES,
  });

  if (submitResponse.status < 200 || submitResponse.status >= 300) {
    throw new Error(`Gradio submit failed with ${submitResponse.status}.`);
  }

  let submitPayload: unknown = null;
  try {
    submitPayload = submitResponse.text ? JSON.parse(submitResponse.text) : null;
  } catch {
    // handled below
  }

  const eventId =
    submitPayload && typeof submitPayload === "object" && "event_id" in submitPayload
      ? String((submitPayload as { event_id?: unknown }).event_id ?? "")
      : "";
  if (!eventId) throw new Error("Gradio did not return an event ID.");

  const pollTarget = withPath(
    space,
    `/gradio_api/call/${encodeURIComponent(step.apiName)}/${encodeURIComponent(eventId)}`
  );
  const pollResponse = await pinnedHttpsRequest(pollTarget, {
    method: "GET",
    headers: { Accept: "text/event-stream" },
    timeoutMs: REQUEST_TIMEOUT_MS,
    maxResponseBytes: MAX_RESPONSE_BYTES,
  });

  if (pollResponse.status < 200 || pollResponse.status >= 300) {
    throw new Error(`Gradio result request failed with ${pollResponse.status}.`);
  }

  const completed = parseSseComplete(pollResponse.text);
  const outputs = Array.isArray(completed) ? completed : [completed];
  return { completed, selected: outputs[step.outputIndex] };
}

async function callOfficialWorkflow(
  space: ValidatedHttpsTarget,
  plan: ParsedPlan,
  message: unknown
) {
  if (!space.hostname.endsWith(".hf.space")) {
    throw new Error("Stateful Gradio workflows are currently limited to Hugging Face Spaces.");
  }

  // Stateful workflows use the official Gradio client to preserve session state.
  // That client owns its network transport, so this path cannot provide the same
  // DNS-pinning guarantee as BENCHRX's pinned single-step connector. Restricting
  // it to Hugging Face-controlled *.hf.space origins is therefore mandatory.
  const app = await withTimeout(
    Client.connect(space.url.origin),
    "Gradio workflow connection"
  );
  const completedResults: unknown[] = [];
  const selectedResults: unknown[] = [];

  for (const step of plan.steps) {
    const data = replacePlaceholders(step.inputs, message, selectedResults);
    if (!Array.isArray(data)) {
      throw new Error(`Gradio workflow step ${step.apiName} inputs did not resolve to an array.`);
    }

    const result = await withTimeout(
      app.predict(`/${step.apiName}`, data),
      `Gradio workflow step ${step.apiName}`
    );
    const completed = result.data;
    const outputs = Array.isArray(completed) ? completed : [completed];
    completedResults.push(completed);
    selectedResults.push(outputs[step.outputIndex]);
  }

  return { completedResults, selectedResults };
}

export async function POST(request: Request) {
  try {
    const adapterUrl = new URL(request.url);
    const space = await validateAndPinPublicHttpsUrl(
      adapterUrl.searchParams.get("space")?.trim() ?? "",
      {
        invalidUrlMessage: "Enter a valid Gradio Space URL.",
        httpsRequiredMessage: "Gradio Space endpoints must use HTTPS.",
      }
    );

    const plan = parsePlan(
      adapterUrl.searchParams.get("inputs") ?? "[]",
      adapterUrl.searchParams.get("apiName") ?? "chat",
      adapterUrl.searchParams.get("outputIndex") ?? "0"
    );

    const incoming = await request.json().catch(() => ({}));
    const hasMessage =
      incoming &&
      typeof incoming === "object" &&
      Object.prototype.hasOwnProperty.call(incoming, "message");
    const message = hasMessage ? (incoming as { message?: unknown }).message : undefined;

    let completedResults: unknown[];
    let selectedResults: unknown[];

    if (plan.isWorkflow) {
      ({ completedResults, selectedResults } = await callOfficialWorkflow(space, plan, message));
    } else {
      const step = plan.steps[0];
      const data = replacePlaceholders(step.inputs, message, []);
      if (!Array.isArray(data)) {
        throw new Error(`Gradio step ${step.apiName} inputs did not resolve to an array.`);
      }
      const result = await callPinnedSingleStep(space, step, data);
      completedResults = [result.completed];
      selectedResults = [result.selected];
    }

    const finalStep = plan.steps[plan.finalStepIndex];
    const finalValue = selectedResults[plan.finalStepIndex];
    const responseText = extractAssistantText(finalValue);

    if (!responseText) {
      return NextResponse.json(
        {
          error: "Gradio completed but BENCHRX could not extract a text response.",
          upstream: completedResults[plan.finalStepIndex],
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
      clientMode: plan.isWorkflow ? "official" : "pinned",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gradio adapter failed";
    console.error("Gradio adapter failed", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
