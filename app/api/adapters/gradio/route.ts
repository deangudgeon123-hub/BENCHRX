import { isIP } from "node:net";
import { resolve4, resolve6 } from "node:dns/promises";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const REQUEST_TIMEOUT_MS = 18_000;
const MAX_RESPONSE_BYTES = 1_000_000;

type JsonObject = Record<string, unknown>;

function isPrivateIpv4(ip: string) {
  const octets = ip.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => Number.isNaN(value))) return true;

  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

function isPrivateIpv6(ip: string) {
  const normalized = ip.toLowerCase();
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.")
  );
}

function isPrivateIp(ip: string) {
  const version = isIP(ip);
  if (version === 4) return isPrivateIpv4(ip);
  if (version === 6) return isPrivateIpv6(ip);
  return true;
}

async function validatePublicHttpsOrigin(rawUrl: string) {
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    throw new Error("Enter a valid Gradio Space URL.");
  }

  if (target.protocol !== "https:") {
    throw new Error("Gradio Space endpoints must use HTTPS.");
  }

  if (target.username || target.password) {
    throw new Error("Credentials are not allowed in the Space URL.");
  }

  const hostname = target.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new Error("Private or local endpoints are not allowed.");
  }

  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error("Private or local endpoints are not allowed.");
    }
    return target.origin;
  }

  const addresses: string[] = [];
  try {
    addresses.push(...(await resolve4(hostname)));
  } catch {
    // IPv6-only hosts are handled below.
  }
  try {
    addresses.push(...(await resolve6(hostname)));
  } catch {
    // IPv4-only hosts are handled above.
  }

  if (!addresses.length || addresses.some((address) => isPrivateIp(address))) {
    throw new Error("Private or local endpoints are not allowed.");
  }

  return target.origin;
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

async function readLimitedBody(response: Response) {
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
    throw new Error("Gradio response was too large.");
  }
  return text;
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
    if (event === "complete") {
      return data;
    }
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
    const spaceOrigin = await validatePublicHttpsOrigin(
      adapterUrl.searchParams.get("space")?.trim() ?? ""
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
      incoming && typeof incoming === "object" && Object.prototype.hasOwnProperty.call(incoming, "message");
    const message = hasMessage ? (incoming as { message?: unknown }).message : undefined;
    const data = replaceMessage(inputTemplate, message);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const submitUrl = `${spaceOrigin}/gradio_api/call/${encodeURIComponent(apiName)}`;
      const submitResponse = await fetch(submitUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data }),
        cache: "no-store",
        redirect: "manual",
        signal: controller.signal,
      });

      if (submitResponse.status >= 300 && submitResponse.status < 400) {
        throw new Error("Gradio submit endpoint returned a redirect.");
      }

      const submitText = await readLimitedBody(submitResponse);
      let submitPayload: unknown = null;
      try {
        submitPayload = submitText ? JSON.parse(submitText) : null;
      } catch {
        // handled below
      }

      if (!submitResponse.ok) {
        throw new Error(`Gradio submit failed with ${submitResponse.status}.`);
      }

      const eventId =
        submitPayload && typeof submitPayload === "object" && "event_id" in submitPayload
          ? String((submitPayload as { event_id?: unknown }).event_id ?? "")
          : "";
      if (!eventId) {
        throw new Error("Gradio did not return an event ID.");
      }

      const pollUrl = `${spaceOrigin}/gradio_api/call/${encodeURIComponent(apiName)}/${encodeURIComponent(eventId)}`;
      const pollResponse = await fetch(pollUrl, {
        method: "GET",
        headers: { Accept: "text/event-stream" },
        cache: "no-store",
        redirect: "manual",
        signal: controller.signal,
      });

      if (!pollResponse.ok) {
        throw new Error(`Gradio result request failed with ${pollResponse.status}.`);
      }

      const resultText = await readLimitedBody(pollResponse);
      const completed = parseSseComplete(resultText);
      const outputs = Array.isArray(completed) ? completed : [completed];
      const selected = outputs[outputIndex];
      const responseText = extractText(selected);

      if (!responseText) {
        return NextResponse.json(
          { error: "Gradio completed but BENCHRX could not extract a text response.", upstream: completed },
          { status: 502 }
        );
      }

      return NextResponse.json({
        response: responseText,
        provider: "gradio",
        targetHost: new URL(spaceOrigin).hostname,
        apiName,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gradio adapter failed";
    console.error("Gradio adapter failed", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
