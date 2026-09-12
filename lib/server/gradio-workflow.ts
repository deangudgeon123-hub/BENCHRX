import {randomUUID} from "node:crypto";
import {namedCallCapability, queueCallCapability} from './connectors/gradio-transport.ts';
import {GradioInvocationError} from "./gradio-errors.ts";
import {hasNamedCallTerminalEvent, hasQueueTerminalEvent, parseSseComplete, parseQueueSseComplete} from "./gradio-output.ts";
import {pinnedHttpsRequest, PinnedRequestTimeoutError, type ValidatedHttpsTarget} from "./pinned-https.ts";
const REQUEST_TIMEOUT_MS = 18_000;
const WORKFLOW_TIMEOUT_MS = 125_000;
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

function containsRequiredValue(value: unknown): boolean {
  if (typeof value === 'string') return value.includes('<REQUIRED:');
  if (Array.isArray(value)) return value.some(containsRequiredValue);
  if (value && typeof value === 'object') return Object.values(value).some(containsRequiredValue);
  return false;
}

export function parsePlan(raw: string, apiNameRaw: string, outputIndexRaw: string): ParsedPlan {
  const plan = parseGradioTemplate(raw, apiNameRaw, outputIndexRaw);
  assertResolvedInputs(plan);
  return plan;
}

function assertResolvedInputs(plan: ParsedPlan) {
  if (plan.steps.some(step => containsRequiredValue(step.inputs))) {
    throw new Error('Fill every REQUIRED Gradio input before invoking the connector.');
  }
}

// Validates an editable template's structure only. Execution independently rejects
// unresolved values even if a caller passes this plan directly rather than parsePlan.
export function parseGradioTemplate(raw: string, apiNameRaw: string, outputIndexRaw: string): ParsedPlan {
  if(raw.length>16384) throw new Error("Gradio configuration too large");
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
  if (finalStepIndex !== steps.length-1) {
    throw new Error("Gradio finalStep must be the last step.");
  }

  return { steps, finalStepIndex, isWorkflow: true };
}

function getPath(value: unknown, path: number[]): unknown {
  let cursor = value;
  for (const index of path) {
    if (!Array.isArray(cursor) || index < 0 || index >= cursor.length) throw new Error("Invalid workflow output reference");
    cursor = cursor[index];
  }
  return cursor;
}

export function replacePlaceholders(value: unknown, message: unknown, stepResults: unknown[], stepOutputs: unknown[][] = []): unknown {
  if (value === "{{message}}") return message;

  if (typeof value === "string") {
    const outputMatch = value.match(/^\{\{step(\d+)\.outputs((?:\.\d+)*)\}\}$/);
    if (outputMatch) {
      const stepIndex = Number(outputMatch[1]);
      if (stepIndex >= stepOutputs.length) throw new Error("Workflow references must point to completed earlier steps");
      const path = outputMatch[2].split('.').filter(Boolean).map(Number);
      return path.length ? getPath(stepOutputs[stepIndex], path) : stepOutputs[stepIndex];
    }
    const match = value.match(/^\{\{step(\d+)((?:\.\d+)*)\}\}$/);
    if (match) {
      const stepIndex = Number(match[1]);
      const path = match[2]
        ? match[2].split(".").filter(Boolean).map((part) => Number(part))
        : [];
      if(stepIndex>=stepResults.length) throw new Error("Workflow references must point to completed earlier steps");
      const source = stepResults[stepIndex];
      return path.length ? getPath(source, path) : source;
    }
  }

  if (Array.isArray(value)) {
    return value.map((item) => replacePlaceholders(item, message, stepResults, stepOutputs));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonObject).map(([key, item]) => [
        key,
        replacePlaceholders(item, message, stepResults, stepOutputs),
      ])
    );
  }

  return value;
}

async function requestOrInvocationError(
  target: ValidatedHttpsTarget,
  options: Parameters<typeof pinnedHttpsRequest>[1],
  stage: 'submit' | 'poll',
  transport: typeof pinnedHttpsRequest,
) {
  return transport(target, options).catch(error => {
    throw new GradioInvocationError(stage, error instanceof PinnedRequestTimeoutError ? 'timeout' : 'transport');
  });
}

async function capabilitySubmit(
  space: ValidatedHttpsTarget, step: WorkflowStep, data: unknown[], deadline: number,
  transport: typeof pinnedHttpsRequest,
) {
  const readCapability = async (path: string): Promise<unknown> => {
    const response = await requestOrInvocationError(withPath(space, path), {
      method: 'GET', headers: {Accept: 'application/json'},
      timeoutMs: remainingTime(deadline), maxResponseBytes: MAX_RESPONSE_BYTES,
    }, 'submit', transport);
    if (response.status < 200 || response.status >= 300) return null;
    try {return JSON.parse(response.text);} catch {return null;}
  };
  const info = await readCapability('/gradio_api/info');
  const names = namedCallCapability(info, step.apiName, data.length);
  let path: string, payload: unknown, fallbackSessionHash: string | undefined;
  if (names) {
    path = `/gradio_api/call/v2/${encodeURIComponent(step.apiName)}`;
    payload = Object.fromEntries(names.map((name, i) => [name, data[i]]));
  } else {
    const config = await readCapability('/config');
    const fnIndex = queueCallCapability(info, config, step.apiName, data.length);
    if (fnIndex === null) return null;
    path = '/gradio_api/queue/join';
    fallbackSessionHash = randomUUID();
    payload = {data, fn_index: fnIndex, session_hash: fallbackSessionHash};
  }
  let body: string;
  try {body = JSON.stringify(payload);} catch {throw new GradioInvocationError('payload', 'serialization');}
  const response = await requestOrInvocationError(withPath(space, path), {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body,
    timeoutMs: remainingTime(deadline), maxResponseBytes: MAX_RESPONSE_BYTES,
  }, 'submit', transport);
  // Exactly one evidence-selected alternative. Its failure is not permission to
  // submit the same request again through another transport.
  return {response, fallbackSessionHash};
}

async function callPinnedSingleStep(
  space: ValidatedHttpsTarget,
  step: WorkflowStep,
  data: unknown[],
  sessionHash: string | undefined,
  deadline: number,
  transport: typeof pinnedHttpsRequest = pinnedHttpsRequest
) {
  const submitTarget = withPath(space, `/gradio_api/call/${encodeURIComponent(step.apiName)}`);
  let body: string;
  try {body = JSON.stringify({data, ...(sessionHash ? {session_hash: sessionHash} : {})});}
  catch {throw new GradioInvocationError('payload', 'serialization');}
  let submitResponse = await requestOrInvocationError(submitTarget, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    timeoutMs: remainingTime(deadline),
    maxResponseBytes: MAX_RESPONSE_BYTES,
  }, 'submit', transport);
  let fallbackSessionHash: string | undefined;

  // Only a single-step legacy 404 permits public capability inspection. Neither
  // arbitrary HTTP failures nor a failed alternative trigger another submission.
  if (submitResponse.status === 404 && !sessionHash) {
    const alternative = await capabilitySubmit(space, step, data, deadline, transport);
    if (alternative) {
      submitResponse = alternative.response;
      fallbackSessionHash = alternative.fallbackSessionHash;
    }
  }

  if (submitResponse.status < 200 || submitResponse.status >= 300) {
    throw new GradioInvocationError('submit', 'http_status', submitResponse.status);
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
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(eventId)) throw new GradioInvocationError('event_id', 'invalid_event_id');

  const queueSessionHash = sessionHash ?? fallbackSessionHash;
  const pollTarget = withPath(
    space,
    queueSessionHash ? `/gradio_api/queue/data?session_hash=${encodeURIComponent(queueSessionHash)}` :
      `/gradio_api/call/${encodeURIComponent(step.apiName)}/${encodeURIComponent(eventId)}`
  );
  const pollResponse = await requestOrInvocationError(pollTarget, {
    method: "GET",
    headers: { Accept: "text/event-stream" },
    // SSE is one long-lived response: use the remaining workflow budget, not the
    // short submit timeout. Heartbeats must not reset the absolute deadline.
    timeoutMs: remainingTime(deadline, 'poll'),
    maxResponseBytes: MAX_RESPONSE_BYTES,
    completeWhen: queueSessionHash
      ? (text) => hasQueueTerminalEvent(text, eventId)
      : hasNamedCallTerminalEvent,
  }, 'poll', transport);

  if (pollResponse.status < 200 || pollResponse.status >= 300) {
    throw new GradioInvocationError('poll', 'http_status', pollResponse.status);
  }

  const completed = queueSessionHash ? parseQueueSseComplete(pollResponse.text, eventId) : parseSseComplete(pollResponse.text);
  const outputs = Array.isArray(completed) ? completed : [completed];
  if(step.outputIndex>=outputs.length) throw new GradioInvocationError('output', 'invalid_output');
  return { completed, outputs, selected: outputs[step.outputIndex] };
}

function remainingTime(deadline:number, stage: 'submit' | 'poll' = 'submit'): number {
  const remaining=deadline-Date.now();
  if(remaining<=0)throw new GradioInvocationError(stage, 'timeout');
  return stage === 'poll' ? remaining : Math.min(REQUEST_TIMEOUT_MS,remaining);
}

// One fresh session per benchmark request; all steps share it. No cross-test state.
export async function executeGradioPlan(
  space:ValidatedHttpsTarget,plan:ParsedPlan,message:unknown,
  transport:typeof pinnedHttpsRequest=pinnedHttpsRequest
) {
  assertResolvedInputs(plan);
  const sessionHash=randomUUID();
  const deadline=Date.now()+WORKFLOW_TIMEOUT_MS;
  const selectedResults:unknown[]=[];
  const stepOutputs:unknown[][]=[];
  for(const [stepIndex, step] of plan.steps.entries()) {
    const data=replacePlaceholders(step.inputs,message,selectedResults,stepOutputs);
    if(!Array.isArray(data))throw new Error("Invalid workflow inputs");
    const result=await callPinnedSingleStep(space,step,data,plan.isWorkflow ? sessionHash : undefined,deadline,transport).catch(error => {
      if (error instanceof GradioInvocationError) error.stepIndex = stepIndex;
      throw error;
    });
    selectedResults.push(result.selected);
    stepOutputs.push(result.outputs);
  }
  return selectedResults;
}
