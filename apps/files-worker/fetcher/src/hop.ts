import {
  assertUrlStructureSafe,
  detectIpVersion,
  isBlockedIp,
  SsrfError,
} from "../../../../packages/convex/linkMetadata/ssrf";
import type { FetchAssetDeps } from "./fetchAsset";
import {
  FETCHER_HOP_MAX_BYTES,
  FETCHER_HOP_MAX_TIMEOUT_MS,
  FETCHER_HOP_REQUEST_HEADERS,
  type FetcherHopFailureReason,
  type FetcherHopRequest,
} from "./protocol";

const MAX_URL_LENGTH = 4096;
const MAX_ADDRESSES = 32;
const MAX_HEADER_VALUE_LENGTH = 512;

const isPositiveInteger = (value: unknown, max: number): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value > 0 &&
  value <= max;

export const parseFetcherHopRequest = (
  value: unknown
): FetcherHopRequest | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const { addresses, headers, maxBytes, timeoutMs, url } = value as Record<
    string,
    unknown
  >;
  if (
    typeof url !== "string" ||
    !url ||
    url.length > MAX_URL_LENGTH ||
    !Array.isArray(addresses) ||
    addresses.length === 0 ||
    addresses.length > MAX_ADDRESSES ||
    addresses.some(
      (address) => typeof address !== "string" || detectIpVersion(address) === 0
    ) ||
    !isPositiveInteger(maxBytes, FETCHER_HOP_MAX_BYTES) ||
    !isPositiveInteger(timeoutMs, FETCHER_HOP_MAX_TIMEOUT_MS) ||
    !headers ||
    typeof headers !== "object" ||
    Array.isArray(headers)
  ) {
    return null;
  }
  const allowed = new Set<string>(FETCHER_HOP_REQUEST_HEADERS);
  const entries = Object.entries(headers as Record<string, unknown>);
  if (
    entries.some(
      ([name, headerValue]) =>
        !allowed.has(name) ||
        typeof headerValue !== "string" ||
        headerValue.length > MAX_HEADER_VALUE_LENGTH
    )
  ) {
    return null;
  }
  return {
    addresses: addresses as string[],
    headers: Object.fromEntries(entries) as FetcherHopRequest["headers"],
    maxBytes,
    timeoutMs,
    url,
  };
};

export type HopOutcome =
  | {
      body: Uint8Array;
      contentLength: string | null;
      contentType: string | null;
      location: string | null;
      ok: true;
      status: number;
    }
  | { ok: false; reason: FetcherHopFailureReason };

/** At most `limit` bytes of the body; the rest is never read. */
const readAtMost = async (
  response: Response,
  limit: number
): Promise<Uint8Array> => {
  if (!response.body) {
    return new Uint8Array(0);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < limit) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    const kept = value.subarray(0, limit - total);
    chunks.push(kept);
    total += kept.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

/**
 * Makes one request for the Worker's `safeFetch`. The Worker resolved the
 * host and checked its addresses; they are checked here again with the same
 * policy, so this endpoint never reaches a private address whatever it is
 * sent. The connection is pinned to those addresses, and a redirect comes
 * back as it is, for the Worker to check its target before the next hop.
 */
export const performHop = async (
  request: FetcherHopRequest,
  { pinnedFetch }: Pick<FetchAssetDeps, "pinnedFetch">
): Promise<HopOutcome> => {
  try {
    assertUrlStructureSafe(request.url);
  } catch (error) {
    if (error instanceof SsrfError) {
      return { ok: false, reason: "blocked_url" };
    }
    throw error;
  }
  if (request.addresses.some(isBlockedIp)) {
    return { ok: false, reason: "blocked_url" };
  }
  let response: Response;
  try {
    response = await pinnedFetch(request.url, request.addresses, {
      headers: request.headers,
      redirect: "manual",
      signal: AbortSignal.timeout(request.timeoutMs),
    });
  } catch {
    return { ok: false, reason: "fetch_failed" };
  }
  let body: Uint8Array;
  try {
    body = await readAtMost(response, request.maxBytes + 1);
  } catch {
    return { ok: false, reason: "fetch_failed" };
  }
  return {
    body,
    contentLength: response.headers.get("content-length"),
    contentType: response.headers.get("content-type"),
    location: response.headers.get("location"),
    ok: true,
    status: response.status,
  };
};
