import {
  type FetchAssetDeps,
  fetchRemoteAsset,
  parseFetcherRequest,
} from "./fetchAsset";
import { fetchLinkPage, parseFetcherPageRequest } from "./fetchPage";
import { parseFetcherHopRequest, performHop } from "./hop";
import {
  FETCHER_HEADERS,
  FETCHER_HOP_PATH,
  FETCHER_HOP_RESPONSE_HEADERS,
  FETCHER_MAX_IN_FLIGHT,
  FETCHER_PAGE_PATH,
  FETCHER_PATH,
  FETCHER_PROTOCOL,
} from "./protocol";

const MAX_REQUEST_BYTES = 16 * 1024;

const json = (status: number, body: unknown): Response =>
  Response.json(body, { status });

export const createFetcherHandler = (deps: FetchAssetDeps) => {
  let inFlight = 0;
  return async (request: Request): Promise<Response> => {
    const { pathname } = new URL(request.url);
    if (request.method === "GET" && pathname === "/health") {
      return json(200, { inFlight, ok: true, protocol: FETCHER_PROTOCOL });
    }
    if (
      request.method !== "POST" ||
      !(
        pathname === FETCHER_PATH ||
        pathname === FETCHER_PAGE_PATH ||
        pathname === FETCHER_HOP_PATH
      )
    ) {
      return json(404, { error: "not_found" });
    }
    const body = await request.text();
    if (body.length > MAX_REQUEST_BYTES) {
      return json(400, { error: "invalid_request" });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return json(400, { error: "invalid_request" });
    }
    if (pathname === FETCHER_HOP_PATH) {
      const hopRequest = parseFetcherHopRequest(parsed);
      if (!hopRequest) {
        return json(400, { error: "invalid_request" });
      }
      if (inFlight >= FETCHER_MAX_IN_FLIGHT) {
        return json(503, { error: "busy" });
      }
      inFlight += 1;
      try {
        const outcome = await performHop(hopRequest, deps);
        if (!outcome.ok) {
          return json(422, { error: "skipped", reason: outcome.reason });
        }
        const headers = new Headers({
          "content-length": String(outcome.body.byteLength),
          "content-type": "application/octet-stream",
          [FETCHER_HOP_RESPONSE_HEADERS.status]: String(outcome.status),
        });
        for (const [name, value] of [
          [FETCHER_HOP_RESPONSE_HEADERS.contentLength, outcome.contentLength],
          [FETCHER_HOP_RESPONSE_HEADERS.contentType, outcome.contentType],
          [FETCHER_HOP_RESPONSE_HEADERS.location, outcome.location],
        ] as const) {
          if (value !== null) {
            headers.set(name, value);
          }
        }
        return new Response(new Uint8Array(outcome.body), {
          headers,
          status: 200,
        });
      } finally {
        inFlight -= 1;
      }
    }
    if (pathname === FETCHER_PAGE_PATH) {
      const pageRequest = parseFetcherPageRequest(parsed);
      if (!pageRequest) {
        return json(400, { error: "invalid_request" });
      }
      if (inFlight >= FETCHER_MAX_IN_FLIGHT) {
        return json(503, { error: "busy" });
      }
      inFlight += 1;
      try {
        const { ok, ...outcome } = await fetchLinkPage(pageRequest, deps);
        return ok
          ? json(200, outcome)
          : json(422, { error: "skipped", ...outcome });
      } finally {
        inFlight -= 1;
      }
    }
    const fetcherRequest = parseFetcherRequest(parsed);
    if (!fetcherRequest) {
      return json(400, { error: "invalid_request" });
    }
    if (inFlight >= FETCHER_MAX_IN_FLIGHT) {
      return json(503, { error: "busy" });
    }
    inFlight += 1;
    try {
      const outcome = await fetchRemoteAsset(fetcherRequest, deps);
      if (!outcome.ok) {
        return json(422, {
          error: "skipped",
          reason: outcome.reason,
          ...(outcome.status === undefined ? {} : { status: outcome.status }),
        });
      }
      const headers = new Headers({
        "content-length": String(outcome.bytes.byteLength),
        "content-type": "application/octet-stream",
        [FETCHER_HEADERS.contentType]: outcome.contentType,
      });
      if (outcome.width && outcome.height) {
        headers.set(FETCHER_HEADERS.width, String(outcome.width));
        headers.set(FETCHER_HEADERS.height, String(outcome.height));
      }
      return new Response(new Uint8Array(outcome.bytes), {
        headers,
        status: 200,
      });
    } finally {
      inFlight -= 1;
    }
  };
};
