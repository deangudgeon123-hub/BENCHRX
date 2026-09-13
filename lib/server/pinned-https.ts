import ipaddr from "ipaddr.js";
import { resolve4, resolve6 } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

export type ValidatedHttpsTarget = {
  url: URL;
  hostname: string;
  address: string;
  family: 4 | 6;
};

type PinnedRequestOptions = {
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
  maxResponseBytes: number;
  completeWhen?: (text: string) => boolean;
  // Streaming protocols may discard fully parsed, explicitly nonterminal frames.
  // The returned buffer must be no larger than the input and the retained/unparsed
  // bytes remain subject to maxResponseBytes.
  compactWhenIncomplete?: (buffer: Buffer) => Buffer;
};

export type PinnedResponse = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  text: string;
};

export function isPublicIp(ip: string): boolean {
  try {
    const address = ipaddr.parse(ip);
    // Mapped/tunnel/reserved IPv6 ranges are intentionally unsupported.
    return address.range() === "unicast";
  } catch { return false; }
}

async function boundedDns<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([operation, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("DNS resolution timed out.")), 5000);
  })]); } finally { if (timer) clearTimeout(timer); }
}

export async function validateAndPinPublicHttpsUrl(
  rawUrl: string,
  options: {
    invalidUrlMessage: string;
    httpsRequiredMessage: string;
  }
): Promise<ValidatedHttpsTarget> {
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    throw new Error(options.invalidUrlMessage);
  }

  if (target.protocol !== "https:" || (target.port && target.port !== "443") || target.hash) {
    throw new Error(options.httpsRequiredMessage);
  }

  if (target.username || target.password) {
    throw new Error("Credentials are not allowed in the target URL.");
  }

  const hostname = target.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new Error("Private or local endpoints are not allowed.");
  }

  const literalFamily = isIP(hostname);
  if (literalFamily) {
    if (!isPublicIp(hostname)) {
      throw new Error("Private or local endpoints are not allowed.");
    }
    return {
      url: target,
      hostname,
      address: hostname,
      family: literalFamily as 4 | 6,
    };
  }

  const addresses: Array<{ address: string; family: 4 | 6 }> = [];
  try {
    const ipv4 = await boundedDns(resolve4(hostname));
    addresses.push(...ipv4.map((address) => ({ address, family: 4 as const })));
  } catch {
    // IPv6-only hosts are handled below.
  }
  try {
    const ipv6 = await boundedDns(resolve6(hostname));
    addresses.push(...ipv6.map((address) => ({ address, family: 6 as const })));
  } catch {
    // IPv4-only hosts are handled above.
  }

  if (!addresses.length || addresses.some(({ address }) => !isPublicIp(address))) {
    throw new Error("Private or local endpoints are not allowed.");
  }

  const pinned = addresses[0];
  return {
    url: target,
    hostname,
    address: pinned.address,
    family: pinned.family,
  };
}

// A trusted local timeout marker; never classify from upstream text or error strings.
export class PinnedRequestTimeoutError extends Error {
  constructor() { super("Upstream request deadline exceeded."); }
}

// A local resource limit, never inferred from a remote error message.
export class PinnedResponseLimitError extends Error {
  constructor() { super("Upstream response exceeded the local byte limit."); }
}

export async function pinnedHttpsRequest(
  target: ValidatedHttpsTarget,
  options: PinnedRequestOptions
): Promise<PinnedResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;

    const finishReject = (error: Error) => {
      if (settled) return;
      settled = true;
      if (deadline) clearTimeout(deadline);
      reject(error);
    };

    const req = httpsRequest(
      target.url,
      {
        method: options.method,
        headers: options.headers,
        servername: isIP(target.hostname) ? undefined : target.hostname,
        lookup: (_hostname, lookupOptions, callback) => {
          const wantsAll =
            typeof lookupOptions === "object" &&
            lookupOptions !== null &&
            "all" in lookupOptions &&
            Boolean(lookupOptions.all);

          if (wantsAll) {
            (callback as unknown as (
              error: NodeJS.ErrnoException | null,
              addresses: Array<{ address: string; family: number }>
            ) => void)(null, [{ address: target.address, family: target.family }]);
            return;
          }

          (callback as unknown as (
            error: NodeJS.ErrnoException | null,
            address: string,
            family: number
          ) => void)(null, target.address, target.family);
        },
      },
      (response) => {
        let retained = Buffer.alloc(0);

        const finishResolve = () => {
          if (settled) return;
          settled = true;
          if (deadline) clearTimeout(deadline);
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            text: retained.toString("utf8"),
          });
        };

        const compactRetained = (): boolean => {
          if (!options.compactWhenIncomplete) return true;
          try {
            const next = options.compactWhenIncomplete(retained);
            if (!Buffer.isBuffer(next) || next.byteLength > retained.byteLength) {
              throw new Error("Invalid streaming compaction result.");
            }
            retained = next;
            return true;
          } catch {
            finishReject(new Error("Upstream response compaction failed."));
            response.destroy();
            return false;
          }
        };

        const isComplete = (): boolean | null => {
          if (!options.completeWhen) return false;
          try {
            return options.completeWhen(retained.toString("utf8"));
          } catch {
            finishReject(new Error("Upstream response completion check failed."));
            response.destroy();
            return null;
          }
        };

        const rejectLimit = () => {
          finishReject(new PinnedResponseLimitError());
          response.destroy();
        };

        response.on("aborted", () => finishReject(new Error("Upstream response aborted.")));
        response.on("error", finishReject);
        response.on("data", (chunk: Buffer | string) => {
          if (settled) return;
          const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          let offset = 0;

          // Consume a network chunk in bounded slices. Fully framed nonterminal
          // streaming events may be compacted between slices, so aggregate stream
          // history cannot force retained/unparsed bytes above the configured cap.
          while (offset < incoming.byteLength && !settled) {
            let available = options.maxResponseBytes - retained.byteLength;
            if (available <= 0) {
              if (!compactRetained()) return;
              available = options.maxResponseBytes - retained.byteLength;
              if (available <= 0) {
                rejectLimit();
                return;
              }
            }

            const take = Math.min(available, incoming.byteLength - offset);
            retained = Buffer.concat(
              [retained, incoming.subarray(offset, offset + take)],
              retained.byteLength + take,
            );
            offset += take;

            const complete = isComplete();
            if (complete === null) return;
            if (complete) {
              finishResolve();
              response.destroy();
              return;
            }

            if (!compactRetained()) return;

            if (offset < incoming.byteLength && retained.byteLength >= options.maxResponseBytes) {
              rejectLimit();
              return;
            }
          }
        });

        response.on("end", finishResolve);
      }
    );

    deadline = setTimeout(() => req.destroy(new PinnedRequestTimeoutError()), options.timeoutMs);
    req.setTimeout(options.timeoutMs, () => {
      req.destroy(new PinnedRequestTimeoutError());
    });
    req.on("error", (error) => finishReject(error));

    if (options.body !== undefined) {
      req.write(options.body);
    }
    req.end();
  });
}
