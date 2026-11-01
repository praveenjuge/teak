import { lookup } from "node:dns/promises";
import {
  type DnsResolver,
  detectIpVersion,
  type PinnedFetch,
} from "../../../../packages/convex/linkMetadata/ssrf";

export const systemDnsResolver: DnsResolver = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
};

interface PinnedAddress {
  address: string;
  family: 4 | 6;
}

export const orderPinnedAddresses = (
  validatedAddresses: string[]
): PinnedAddress[] =>
  validatedAddresses
    .map((address) => ({
      address,
      family: address.includes(":") ? (6 as const) : (4 as const),
    }))
    .sort((left, right) => left.family - right.family);

export interface PinnedAttempt {
  host: string;
  serverName?: string;
  target: string;
}

export const pinnedAttempts = (
  url: string,
  validatedAddresses: string[]
): PinnedAttempt[] => {
  const parsed = new URL(url);
  parsed.hash = "";
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  if (detectIpVersion(hostname) !== 0) {
    return [{ host: parsed.host, target: parsed.href }];
  }
  const tls = parsed.protocol === "https:";
  return orderPinnedAddresses(validatedAddresses).map(({ address, family }) => {
    const target = new URL(parsed);
    target.hostname = family === 6 ? `[${address}]` : address;
    return {
      host: parsed.host,
      target: target.href,
      ...(tls ? { serverName: hostname } : {}),
    };
  });
};

/** Bun's `fetch` options this module relies on (Bun 1.4.3+). */
type BunPinnedInit = RequestInit & {
  proxy: false;
  tls: { ca?: string; rejectUnauthorized: true; serverName?: string };
};

const IDEMPOTENT_METHODS = new Set(["GET", "HEAD"]);

export interface PinnedFetchOptions {
  /** Trusted roots, for tests only; production uses Bun's default roots. */
  ca?: string;
}

/**
 * Bun's fetch connects to the address in the URL and never resolves `Host`
 * or `tls.serverName`, so putting a checked address in the URL pins the
 * connection while the request and certificate still name the original
 * host. Each address is tried in turn while a GET or HEAD fails before a
 * response.
 */
export const createPinnedFetch =
  ({ ca }: PinnedFetchOptions = {}): PinnedFetch =>
  async (url, validatedAddresses, init) => {
    const attempts = pinnedAttempts(url, validatedAddresses);
    if (attempts.length === 0) {
      throw new Error("Validated address set is empty");
    }
    const method = (init.method ?? "GET").toUpperCase();
    const tries = IDEMPOTENT_METHODS.has(method)
      ? attempts
      : attempts.slice(0, 1);
    let lastError: unknown;
    for (const attempt of tries) {
      const headers = new Headers(init.headers);
      headers.set("host", attempt.host);
      const pinnedInit: BunPinnedInit = {
        ...init,
        headers,
        keepalive: false,
        // A proxy would resolve the name itself; never use one.
        proxy: false,
        // A followed redirect would reach a host the policy never checked;
        // the caller validates and issues each hop itself.
        redirect: "manual",
        tls: {
          ...(ca ? { ca } : {}),
          // Overrides NODE_TLS_REJECT_UNAUTHORIZED.
          rejectUnauthorized: true,
          ...(attempt.serverName ? { serverName: attempt.serverName } : {}),
        },
      };
      try {
        return await fetch(attempt.target, pinnedInit);
      } catch (error) {
        if (init.signal?.aborted) {
          throw error;
        }
        lastError = error;
      }
    }
    throw lastError;
  };

export const pinnedFetch: PinnedFetch = createPinnedFetch();
