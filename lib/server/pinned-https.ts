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
        const chunks: Buffer[] = [];
        let totalBytes = 0;

        response.on("aborted", () => finishReject(new Error("Upstream response aborted.")));
        response.on("error", finishReject);
        response.on("data", (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          totalBytes += buffer.byteLength;
          if (totalBytes > options.maxResponseBytes) {
            req.destroy(new Error("Upstream response was too large."));
            return;
          }
          chunks.push(buffer);
        });

        response.on("end", () => {
          if (settled) return;
          settled = true;
          if (deadline) clearTimeout(deadline);
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            text: Buffer.concat(chunks).toString("utf8"),
          });
        });
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
