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

  if (target.protocol !== "https:") {
    throw new Error(options.httpsRequiredMessage);
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

  const literalFamily = isIP(hostname);
  if (literalFamily) {
    if (isPrivateIp(hostname)) {
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
    const ipv4 = await resolve4(hostname);
    addresses.push(...ipv4.map((address) => ({ address, family: 4 as const })));
  } catch {
    // IPv6-only hosts are handled below.
  }
  try {
    const ipv6 = await resolve6(hostname);
    addresses.push(...ipv6.map((address) => ({ address, family: 6 as const })));
  } catch {
    // IPv4-only hosts are handled above.
  }

  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
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

export async function pinnedHttpsRequest(
  target: ValidatedHttpsTarget,
  options: PinnedRequestOptions
): Promise<PinnedResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const finishReject = (error: Error) => {
      if (settled) return;
      settled = true;
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
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            text: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );

    req.setTimeout(options.timeoutMs, () => {
      req.destroy(new Error("Upstream request timed out."));
    });
    req.on("error", (error) => finishReject(error));

    if (options.body !== undefined) {
      req.write(options.body);
    }
    req.end();
  });
}
