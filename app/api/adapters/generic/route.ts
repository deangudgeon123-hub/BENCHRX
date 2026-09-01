import { isIP } from "node:net";
import { resolve4, resolve6 } from "node:dns/promises";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_RESPONSE_BYTES = 1_000_000;
const REQUEST_TIMEOUT_MS = 15_000;
const PATH_PART_PATTERN = /^[A-Za-z0-9_$-]+$/;

type JsonObject = Record<string, unknown>;
type PathPart = string | number;

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

async function validatePublicHttpsUrl(rawUrl: string) {
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    throw new Error("Enter a valid target URL.");
  }

  if (target.protocol !== "https:") {
    throw new Error("Custom agent endpoints must use HTTPS.");
  }

  if (target.username || target.password) {
    throw new Error("Credentials are not allowed in the target URL.");
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
    return target;
  }

  const addresses: string[] = [];
  try {
    addresses.push(...(await resolve4(hostname)));
  } catch {
    // Some public hosts are IPv6-only.
  }
  try {
    addresses.push(...(await resolve6(hostname)));
  } catch {
    // Some public hosts are IPv4-only.
  }

  if (!addresses.length || addresses.some((address) => isPrivateIp(address))) {
    throw new Error("Private or local endpoints are not allowed.");
  }

  return target;
}

function parsePath(value: string, label: string): PathPart[] {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} must be a JSON path.`);
  }

  const normalized = trimmed.replace(/\[(\d+)\]/g, ".$1");
  const rawParts = normalized.split(".");
  if (
    rawParts.some(
      (part) => !part || (!/^\d+$/.test(part) && !PATH_PART_PATTERN.test(part))
    )
  ) {
    throw new Error(
      `${label} must use dot paths and optional array indexes, for example messages[0].content.`
    );
  }

  return rawParts.map((part) => (/^\d+$/.test(part) ? Number(part) : part));
}

function parseFixedBody(raw: string): JsonObject {
  if (!raw.trim()) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Fixed request JSON must be valid JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Fixed request JSON must be a JSON object.");
  }

  return parsed as JsonObject;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function setPath(rootValue: JsonObject, parts: PathPart[], value: unknown) {
  const root = cloneJson(rootValue);
  let cursor: JsonObject | unknown[] = root;

  parts.forEach((part, index) => {
    const isLast = index === parts.length - 1;
    const nextPart = parts[index + 1];

    if (isLast) {
      if (typeof part === "number") {
        if (!Array.isArray(cursor)) {
          throw new Error("Request JSON path uses an array index where the body is not an array.");
        }
        cursor[part] = value;
      } else {
        if (Array.isArray(cursor)) {
          throw new Error("Request JSON path uses an object field where an array index is required.");
        }
        cursor[part] = value;
      }
      return;
    }

    const shouldBeArray = typeof nextPart === "number";

    if (typeof part === "number") {
      if (!Array.isArray(cursor)) {
        throw new Error("Request JSON path uses an array index where the body is not an array.");
      }
      const current = cursor[part];
      if (!current || typeof current !== "object") {
        cursor[part] = shouldBeArray ? [] : {};
      }
      cursor = cursor[part] as JsonObject | unknown[];
    } else {
      if (Array.isArray(cursor)) {
        throw new Error("Request JSON path uses an object field where an array index is required.");
      }
      const current = cursor[part];
      if (!current || typeof current !== "object") {
        cursor[part] = shouldBeArray ? [] : {};
      }
      cursor = cursor[part] as JsonObject | unknown[];
    }
  });

  return root;
}

function deletePath(rootValue: JsonObject, parts: PathPart[]) {
  const root = cloneJson(rootValue);
  let cursor: JsonObject | unknown[] = root;

  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    const next =
      typeof part === "number"
        ? Array.isArray(cursor)
          ? cursor[part]
          : undefined
        : !Array.isArray(cursor)
          ? cursor[part]
          : undefined;

    if (!next || typeof next !== "object") return root;
    cursor = next as JsonObject | unknown[];
  }

  const finalPart = parts[parts.length - 1];
  if (typeof finalPart === "number") {
    if (Array.isArray(cursor)) delete cursor[finalPart];
  } else if (!Array.isArray(cursor)) {
    delete cursor[finalPart];
  }

  return root;
}

function getPath(value: unknown, parts: PathPart[]): unknown {
  let cursor: unknown = value;

  for (const part of parts) {
    if (typeof part === "number") {
      if (!Array.isArray(cursor) || part >= cursor.length) return undefined;
      cursor = cursor[part];
      continue;
    }

    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor) || !(part in cursor)) {
      return undefined;
    }
    cursor = (cursor as JsonObject)[part];
  }

  return cursor;
}

async function readLimitedBody(response: Response) {
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new Error("Agent response was too large.");
  }

  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
    throw new Error("Agent response was too large.");
  }

  return text;
}

export async function POST(request: Request) {
  try {
    const adapterUrl = new URL(request.url);
    const targetRaw = adapterUrl.searchParams.get("target")?.trim() ?? "";
    const requestPathRaw = adapterUrl.searchParams.get("requestPath") ?? "message";
    const responsePathRaw = adapterUrl.searchParams.get("responsePath") ?? "response";
    const fixedBodyRaw = adapterUrl.searchParams.get("fixedBody") ?? "{}";

    const requestPath = parsePath(requestPathRaw, "Request field");
    const responsePath = parsePath(responsePathRaw, "Response field");
    const fixedBody = parseFixedBody(fixedBodyRaw);
    const target = await validatePublicHttpsUrl(targetRaw);

    const incoming = await request.json().catch(() => ({}));
    const hasMessage =
      incoming && typeof incoming === "object" && Object.prototype.hasOwnProperty.call(incoming, "message");
    const message = hasMessage ? (incoming as { message?: unknown }).message : undefined;

    const upstreamBody = hasMessage
      ? setPath(fixedBody, requestPath, message)
      : deletePath(fixedBody, requestPath);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(target, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(upstreamBody),
        cache: "no-store",
        redirect: "manual",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (response.status >= 300 && response.status < 400) {
      return NextResponse.json(
        { error: "Custom agent endpoint returned a redirect. Redirects are not followed." },
        { status: 502 }
      );
    }

    const rawText = await readLimitedBody(response);
    let payload: unknown = null;
    try {
      payload = rawText ? JSON.parse(rawText) : null;
    } catch {
      payload = { text: rawText };
    }

    if (!response.ok) {
      return NextResponse.json(
        {
          error: "Custom agent request failed",
          upstreamStatus: response.status,
          upstream: payload,
        },
        { status: response.status }
      );
    }

    const extracted = getPath(payload, responsePath);
    if (typeof extracted !== "string" || !extracted.trim()) {
      return NextResponse.json(
        {
          error: `No usable string response found at ${responsePathRaw}`,
          upstream: payload,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      response: extracted.trim(),
      provider: "generic",
      targetHost: target.hostname,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generic adapter failed";
    console.error("Generic adapter failed", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
