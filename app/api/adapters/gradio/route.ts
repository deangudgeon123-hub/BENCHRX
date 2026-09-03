import { NextResponse } from "next/server";
import {
  pinnedHttpsRequest,
  validateAndPinPublicHttpsUrl,
  type ValidatedHttpsTarget,
} from "@/lib/server/pinned-https";

export const runtime = "nodejs";

const REQUEST_TIMEOUT_MS = 18_000;
const MAX_RESPONSE_BYTES = 1_000_000;

type JsonObject = Record<string, unknown>;

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

function parseInputTemplate(raw: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "[]");
  } catch {
    throw new Error("Gradio input JSON must be valid JSON.");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Gradio input JSON must be a JSON array.");
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

function replaceMessage(value: unknown, message: unknown): unknown {
  if (value === "{{message}}") return message;
  if (Array.isArray(value)) return value.map((item) => replaceMessage(item, message));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonObject).map(([key, item]) => [key, replaceMessage(item, message)])
    );
  }
  return value;
}

function parseSseComplete(text: string) {
  const blocks = text.split(/\r?\n\r?\n/);
  let latestData: unknown = null;

  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
    const dataText = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");

    if (!dataText) continue;

    let data: unknown = dataText;
    try {
      data = JSON.parse(dataText);
    } catch {
      // Keep text payloads as text.
    }

    if (event === "error") {
      throw new Error(typeof data === "string" ? data : "Gradio job failed.");
    }
    if (event === "complete") return data;
    latestData = data;
  }

  if (latestData !== null) return latestData;
  throw new Error("Gradio did not return a completed result.");
}

function extractText(value: unknown): string {
  if (typeof value === "string") return value.trim();

  if (Array.isArray(value)) {
    for (let index = value.length - 1; index >= 0; index -= 1) {
      const item = value[index];
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const object = item as JsonObject;
        if (object.role === "assistant" && typeof object.content === "string") {
          return object.content.trim();
        }
      }
    }
    for (let index = value.length - 1; index >= 0; index -= 1) {
      const text = extractText(value[index]);
      if (text) return text;
    }
    return "";
  }

  if (value && typeof value === "object") {
    const object = value as JsonObject;
    if (typeof object.content === "string") return object.content.trim();
    if (typeof object.text === "string") return object.text.trim();
    const values = Object.values(object);
    for (let index = values.length - 1; index >= 0; index -= 1) {
      const text = extractText(values[index]);
      if (text) return text;
    }
  }

  return "";
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

    const apiName = normalizeApiName(adapterUrl.searchParams.get("apiName") ?? "chat");
    const inputTemplate = parseInputTemplate(adapterUrl.searchParams.get("inputs") ?? "[]");
    if (!containsMessagePlaceholder(inputTemplate)) {
      throw new Error('Gradio input JSON must contain the exact string "{{message}}".');
    }

    const outputIndexRaw = adapterUrl.searchParams.get("outputIndex") ?? "0";
    const outputIndex = Number(outputIndexRaw);
    if (!Number.isInteger(outputIndex) || outputIndex < 0) {
      throw new Error("Gradio output index must be a non-negative integer.");
    }

    const incoming = await request.json().catch(() => ({}));
    const hasMessage =
      incoming &&
      typeof incoming === "object" &&
      Object.prototype.hasOwnProperty.call(incoming, "message");
    const message = hasMessage ? (incoming as { message?: unknown }).message : undefined;
    const data = replaceMessage(inputTemplate, message);

    const submitTarget = withPath(
      space,
      `/gradio_api/call/${encodeURIComponent(apiName)}`
    );
    const submitResponse = await pinnedHttpsRequest(submitTarget, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data }),
      timeoutMs: REQUEST_TIMEOUT_MS,
      maxResponseBytes: MAX_RESPONSE_BYTES,
    });

    if (submitResponse.status >= 300 && submitResponse.status < 400) {
      throw new Error("Gradio submit endpoint returned a redirect.");
    }

    let submitPayload: unknown = null;
    try {
      submitPayload = submitResponse.text ? JSON.parse(submitResponse.text) : null;
    } catch {
      // handled below
    }

    if (submitResponse.status < 200 || submitResponse.status >= 300) {
      throw new Error(`Gradio submit failed with ${submitResponse.status}.`);
    }

    const eventId =
      submitPayload && typeof submitPayload === "object" && "event_id" in submitPayload
        ? String((submitPayload as { event_id?: unknown }).event_id ?? "")
        : "";
    if (!eventId) {
      throw new Error("Gradio did not return an event ID.");
    }

    const pollTarget = withPath(
      space,
      `/gradio_api/call/${encodeURIComponent(apiName)}/${encodeURIComponent(eventId)}`
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
    const selected = outputs[outputIndex];
    const responseText = extractText(selected);

    if (!responseText) {
      return NextResponse.json(
        {
          error: "Gradio completed but BENCHRX could not extract a text response.",
          upstream: completed,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      response: responseText,
      provider: "gradio",
      targetHost: space.hostname,
      apiName,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gradio adapter failed";
    console.error("Gradio adapter failed", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
