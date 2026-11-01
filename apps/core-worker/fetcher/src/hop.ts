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
  FETCHER_HOP_METHODS,
  FETCHER_HOP_REQUEST_HEADERS,
  FETCHER_STREAM_MAX_BYTES,
  FETCHER_STREAM_MAX_TIMEOUT_MS,
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

export const HOP_LIMITS = {
  buffered: {
    maxBytes: FETCHER_HOP_MAX_BYTES,
    timeoutMs: FETCHER_HOP_MAX_TIMEOUT_MS,
  },
  streamed: {
    maxBytes: FETCHER_STREAM_MAX_BYTES,
    timeoutMs: FETCHER_STREAM_MAX_TIMEOUT_MS,
  },
} as const;

export const parseFetcherHopRequest = (
  value: unknown,
  limits: (typeof HOP_LIMITS)[keyof typeof HOP_LIMITS] = HOP_LIMITS.buffered
): FetcherHopRequest | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const { addresses, headers, maxBytes, method, timeoutMs, url } =
    value as Record<string, unknown>;
  if (
    !(
      method === undefined ||
      (FETCHER_HOP_METHODS as readonly unknown[]).includes(method)
    ) ||
    typeof url !== "string" ||
    !url ||
    url.length > MAX_URL_LENGTH ||
    !Array.isArray(addresses) ||
    addresses.length === 0 ||
    addresses.length > MAX_ADDRESSES ||
    addresses.some(
      (address) => typeof address !== "string" || detectIpVersion(address) === 0
    ) ||
    !isPositiveInteger(maxBytes, limits.maxBytes) ||
    !isPositiveInteger(timeoutMs, limits.timeoutMs) ||
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
    ...(method === "HEAD" ? { method: "HEAD" as const } : {}),
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

interface HopFacts {
  contentLength: string | null;
  contentType: string | null;
  location: string | null;
  status: number;
}

const factsOf = (response: Response): HopFacts => ({
  contentLength: response.headers.get("content-length"),
  contentType: response.headers.get("content-type"),
  location: response.headers.get("location"),
  status: response.status,
});

const openHop = async (
  request: FetcherHopRequest,
  { pinnedFetch }: Pick<FetchAssetDeps, "pinnedFetch">
): Promise<
  | { ok: true; response: Response }
  | { ok: false; reason: FetcherHopFailureReason }
> => {
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
  try {
    const response = await pinnedFetch(request.url, request.addresses, {
      headers: request.headers,
      method: request.method ?? "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(request.timeoutMs),
    });
    return { ok: true, response };
  } catch {
    return { ok: false, reason: "fetch_failed" };
  }
};

export const performHop = async (
  request: FetcherHopRequest,
  deps: Pick<FetchAssetDeps, "pinnedFetch">
): Promise<HopOutcome> => {
  const opened = await openHop(request, deps);
  if (!opened.ok) {
    return opened;
  }
  let body: Uint8Array;
  try {
    body = await readAtMost(opened.response, request.maxBytes + 1);
  } catch {
    return { ok: false, reason: "fetch_failed" };
  }
  return { body, ok: true, ...factsOf(opened.response) };
};

export type StreamedHopOutcome =
  | (HopFacts & { body: ReadableStream<Uint8Array>; ok: true })
  | { ok: false; reason: FetcherHopFailureReason };

/**
 * `performHop`, with the body passed on as it arrives: at most
 * `maxBytes + 1` bytes, then the upstream is cancelled. `done` runs once,
 * when the body ends, fails, is cancelled, or the hop never opens.
 */
export const performStreamedHop = async (
  request: FetcherHopRequest,
  deps: Pick<FetchAssetDeps, "pinnedFetch">,
  done: () => void
): Promise<StreamedHopOutcome> => {
  let finished = false;
  const finish = () => {
    if (!finished) {
      finished = true;
      done();
    }
  };
  const opened = await openHop(request, deps).catch((error: unknown) => {
    finish();
    throw error;
  });
  if (!opened.ok) {
    finish();
    return opened;
  }
  const { response } = opened;
  if (!response.body) {
    finish();
    return {
      body: new ReadableStream({ start: (c) => c.close() }),
      ok: true,
      ...factsOf(response),
    };
  }
  const reader = response.body.getReader();
  const limit = request.maxBytes + 1;
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    async cancel(reason) {
      finish();
      await reader.cancel(reason).catch(() => undefined);
    },
    async pull(controller) {
      try {
        const { done: ended, value } = await reader.read();
        if (ended) {
          finish();
          controller.close();
          return;
        }
        const kept = value.subarray(0, limit - sent);
        sent += kept.byteLength;
        controller.enqueue(kept);
        if (sent >= limit) {
          finish();
          controller.close();
          await reader.cancel().catch(() => undefined);
        }
      } catch (error) {
        finish();
        controller.error(error);
      }
    },
  });
  return { body, ok: true, ...factsOf(response) };
};
