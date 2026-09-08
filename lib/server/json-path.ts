const PATH_PART_PATTERN = /^[A-Za-z0-9_$-]+$/;

type JsonObject = Record<string, unknown>;
type PathPart = string | number;

export function parsePath(value: string, label: string): PathPart[] {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} must be a JSON path.`);

  const normalized = trimmed.replace(/\[(\d+)\]/g, ".$1");
  const rawParts = normalized.split(".");
  if (rawParts.length > 16 || rawParts.some(p => ["__proto__", "prototype", "constructor"].includes(p) || (/^\d+$/.test(p) && (!Number.isSafeInteger(Number(p)) || Number(p) > 1000)))) throw new Error("Unsafe or oversized JSON path.");
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

export function parseFixedBody(raw: string): JsonObject {
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

export function setPath(rootValue: JsonObject, parts: PathPart[], value: unknown) {
  if (parts.some(p => ["__proto__", "prototype", "constructor"].includes(String(p)) || (typeof p === "number" && (!Number.isSafeInteger(p) || p < 0 || p > 1000)))) throw new Error("Unsafe JSON path.");
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

export function deletePath(rootValue: JsonObject, parts: PathPart[]) {
  if (parts.some(p => ["__proto__", "prototype", "constructor"].includes(String(p)) || (typeof p === "number" && (!Number.isSafeInteger(p) || p < 0 || p > 1000)))) throw new Error("Unsafe JSON path.");
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

export function getPath(value: unknown, parts: PathPart[]): unknown {
  let cursor: unknown = value;

  for (const part of parts) {
    if (typeof part === "number") {
      if (!Array.isArray(cursor) || part >= cursor.length) return undefined;
      cursor = cursor[part];
      continue;
    }

    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor) || !Object.prototype.hasOwnProperty.call(cursor, part)) {
      return undefined;
    }
    cursor = (cursor as JsonObject)[part];
  }

  return cursor;
}

