import {
  type DnsResolver,
  type PinnedFetch,
  SAFE_FETCH_TIMEOUT_MS,
  SsrfError,
} from "@teak/convex/linkMetadata/ssrf";
import {
  FETCHER_HOP_PATH,
  FETCHER_HOP_REQUEST_HEADERS,
  FETCHER_HOP_RESPONSE_HEADERS,
  FETCHER_STREAM_PATH,
  type FetcherHopRequest,
} from "../../fetcher/src/protocol";
import {
  FETCHER_START_ALLOWANCE_MS,
  postToFetcher,
  type RemoteAssetEnv,
} from "./remoteAsset";

// A Worker's own `fetch` cannot pin a connection to an address.

const DOH_ENDPOINT = "https://cloudflare-dns.com/dns-query";
const DOH_TIMEOUT_MS = 5000;
const DNS_TYPES = { A: 1, AAAA: 28 } as const;

interface DohAnswer {
  data?: unknown;
  type?: unknown;
}

const lookup = async (
  fetcher: typeof fetch,
  hostname: string,
  type: keyof typeof DNS_TYPES
): Promise<string[]> => {
  const url = new URL(DOH_ENDPOINT);
  url.searchParams.set("name", hostname);
  url.searchParams.set("type", type);
  const response = await fetcher(url.toString(), {
    headers: { accept: "application/dns-json" },
    signal: AbortSignal.timeout(DOH_TIMEOUT_MS),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`doh_status_${response.status}`);
  }
  const body = (await response.json()) as {
    Answer?: DohAnswer[];
    Status?: unknown;
  };
  // NXDOMAIN and friends: the name has no addresses of this type.
  if (body.Status !== 0 || !Array.isArray(body.Answer)) {
    return [];
  }
  // The answer also lists the CNAME chain; only address records count.
  return body.Answer.filter(
    (answer) =>
      answer.type === DNS_TYPES[type] && typeof answer.data === "string"
  ).map((answer) => answer.data as string);
};

export const createDohResolver =
  (fetcher: typeof fetch = fetch): DnsResolver =>
  async (hostname) => {
    const results = await Promise.allSettled([
      lookup(fetcher, hostname, "A"),
      lookup(fetcher, hostname, "AAAA"),
    ]);
    if (results.every((result) => result.status === "rejected")) {
      throw new Error("doh_unavailable");
    }
    return results.flatMap((result) =>
      result.status === "fulfilled" ? result.value : []
    );
  };

const DEFAULT_HOP_MAX_BYTES = 1024 * 1024;

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

const hopHeaders = (init: RequestInit): FetcherHopRequest["headers"] => {
  const given = new Headers(init.headers);
  const headers: FetcherHopRequest["headers"] = {};
  for (const name of FETCHER_HOP_REQUEST_HEADERS) {
    const value = given.get(name);
    if (value !== null) {
      headers[name] = value;
    }
  }
  return headers;
};

const abortable = <T>(
  promise: Promise<T>,
  signal: AbortSignal | null | undefined
): Promise<T> => {
  if (!signal) {
    return promise;
  }
  if (signal.aborted) {
    return Promise.reject(signal.reason);
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
};

type FetcherEnv = Pick<
  RemoteAssetEnv,
  "LINK_FETCHER" | "LINK_FETCHER_INSTANCES"
>;

const containerHop =
  (
    env: FetcherEnv,
    mode:
      | { maxBytes: number; stream: false }
      | { maxBytes: number; stream: true; timeoutMs: number }
  ): PinnedFetch =>
  async (url, addresses, init) => {
    const timeoutMs = mode.stream ? mode.timeoutMs : SAFE_FETCH_TIMEOUT_MS;
    const request: FetcherHopRequest = {
      addresses,
      headers: hopHeaders(init),
      maxBytes: mode.maxBytes,
      timeoutMs,
      url,
    };
    const response = await abortable(
      mode.stream
        ? postToFetcher(
            env,
            FETCHER_STREAM_PATH,
            request,
            Math.random,
            timeoutMs + FETCHER_START_ALLOWANCE_MS
          )
        : postToFetcher(env, FETCHER_HOP_PATH, request),
      init.signal
    );
    if (response.status === 422) {
      const body = (await response.json().catch(() => null)) as {
        reason?: unknown;
      } | null;
      if (body?.reason === "blocked_url") {
        throw new SsrfError(
          "blocked_address",
          "The link fetcher refused the destination"
        );
      }
      throw new TypeError("fetch failed: link fetcher hop failed");
    }
    const status = Number(
      response.headers.get(FETCHER_HOP_RESPONSE_HEADERS.status)
    );
    if (!(response.ok && status >= 200 && status <= 599)) {
      await response.body?.cancel().catch(() => undefined);
      throw new TypeError(
        `fetch failed: link fetcher status ${response.status}`
      );
    }
    const headers = new Headers();
    for (const [name, header] of [
      ["content-length", FETCHER_HOP_RESPONSE_HEADERS.contentLength],
      ["content-type", FETCHER_HOP_RESPONSE_HEADERS.contentType],
      ["location", FETCHER_HOP_RESPONSE_HEADERS.location],
    ] as const) {
      const value = response.headers.get(header);
      if (value !== null) {
        headers.set(name, value);
      }
    }
    if (NULL_BODY_STATUSES.has(status)) {
      await response.body?.cancel().catch(() => undefined);
      return new Response(null, { headers, status });
    }
    const body = mode.stream
      ? response.body
      : await abortable(response.arrayBuffer(), init.signal);
    return new Response(body, { headers, status });
  };

/**
 * A `PinnedFetch` that makes each hop from the link fetcher Container. Only
 * `accept` and `user-agent` travel with the request, and at most `maxBytes`
 * (plus one, so `readBodyWithLimit` sees an overflow) come back.
 */
export const createContainerPinnedFetch = (
  env: FetcherEnv,
  options: { maxBytes?: number } = {}
): PinnedFetch =>
  containerHop(env, {
    maxBytes: options.maxBytes ?? DEFAULT_HOP_MAX_BYTES,
    stream: false,
  });

/**
 * The same hops, with each body streamed back as it arrives rather than
 * held: for a download larger than a hop may carry, like podcast audio.
 * `timeoutMs` bounds the whole hop, body included.
 */
export const createContainerStreamingFetch = (
  env: FetcherEnv,
  options: { maxBytes: number; timeoutMs: number }
): PinnedFetch => containerHop(env, { ...options, stream: true });
