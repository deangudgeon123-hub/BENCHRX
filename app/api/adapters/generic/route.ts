import { NextResponse } from "next/server";
import {
  pinnedHttpsRequest,
  validateAndPinPublicHttpsUrl,
} from "@/lib/server/pinned-https";

export const runtime = "nodejs";

const MAX_RESPONSE_BYTES = 1_000_000;
const REQUEST_TIMEOUT_MS = 15_000;
const PATH_PART_PATTERN = /^[A-Za-z0-9_$-]+$/;

type JsonObject = Record<string, unknown>;
type PathPart = string | number;

function parsePath(value: string, label: string): PathPart[] {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} must be a JSON path.`);

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
      if (!current || typeof current !== "object") cursor[part] = shouldBeArray ? [] : {};
      cursor = cursor[part] as JsonObject | unknown[];
    } else {
      if (Array.isArray(cursor)) {
        throw new Error("Request JSON path uses an object field where an array index is required.");
      }
      const current = cursor[part];
      if (!current || typeof current !== "object") cursor[part] = shouldBeArray ? [] : {};
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
    const target = await validateAndPinPublicHttpsUrl(targetRaw, {
      invalidUrlMessage: "Enter a valid target URL.",
      httpsRequiredMessage: "Custom agent endpoints must use HTTPS.",
    });

    const incoming = await request.json().catch(() => ({}));
    const hasMessage =
      incoming &&
      typeof incoming === "object" &&
      Object.prototype.hasOwnProperty.call(incoming, "message");
    const message = hasMessage ? (incoming as { message?: unknown }).message : undefined;

    const upstreamBody = hasMessage
      ? setPath(fixedBody, requestPath, message)
      : deletePath(fixedBody, requestPath);

    const response = await pinnedHttpsRequest(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(upstreamBody),
      timeoutMs: REQUEST_TIMEOUT_MS,
      maxResponseBytes: MAX_RESPONSE_BYTES,
    });

    if (response.status >= 300 && response.status < 400) {
      return NextResponse.json(
        { error: "Custom agent endpoint returned a redirect. Redirects are not followed." },
        { status: 502 }
      );
    }

    let payload: unknown = null;
    try {
      payload = response.text ? JSON.parse(response.text) : null;
    } catch {
      payload = { text: response.text };
    }

    if (response.status < 200 || response.status >= 300) {
      return NextResponse.json(
        {
          error: "Custom agent request failed",
          upstreamStatus: response.status,
          upstream: payload,
        },
        { status: response.status || 502 }
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
