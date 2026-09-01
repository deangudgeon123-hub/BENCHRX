import { isIP } from "node:net";
import { resolve } from "node:dns/promises";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_RESPONSE_BYTES = 1_000_000;
const REQUEST_TIMEOUT_MS = 15_000;
const PATH_PATTERN = /^[A-Za-z0-9_$-]+(?:\.[A-Za-z0-9_$-]+)*$/;

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

  let addresses: { address: string }[];
  try {
    addresses = await resolve(hostname);
  } catch {
    throw new Error("Could not resolve the target hostname.");
  }

  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error("Private or local endpoints are not allowed.");
  }

  return target;
}

function validatePath(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed || !PATH_PATTERN.test(trimmed)) {
    throw new Error(`${label} must be a dot-separated JSON path.`);
  }
  return trimmed;
}

function setPath(path: string, value: unknown) {
  const parts = path.split(".");
  const root: Record<string, unknown> = {};
  let cursor: Record<string, unknown> = root;

  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      cursor[part] = value;
      return;
    }

    const next: Record<string, unknown> = {};
    cursor[part] = next;
    cursor = next;
  });

  return root;
}

function getPath(value: unknown, path: string): unknown {
  let cursor: unknown = value;

  for (const part of path.split(".")) {
    if (!cursor || typeof cursor !== "object" || !(part in cursor)) return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
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
    const requestPath = validatePath(
      adapterUrl.searchParams.get("requestPath") ?? "message",
      "Request field"
    );
    const responsePath = validatePath(
      adapterUrl.searchParams.get("responsePath") ?? "response",
      "Response field"
    );

    const target = await validatePublicHttpsUrl(targetRaw);
    const incoming = await request.json().catch(() => ({}));
    const hasMessage =
      incoming && typeof incoming === "object" && Object.prototype.hasOwnProperty.call(incoming, "message");
    const message = hasMessage ? (incoming as { message?: unknown }).message : undefined;

    const upstreamBody = hasMessage ? setPath(requestPath, message) : {};
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
          error: `No usable string response found at ${responsePath}`,
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
