import { Hono } from "hono";

const API_VERSION = "v1";
const DEFAULT_PROXY_ERROR = "Failed to reach upstream API";
const DEFAULT_UPSTREAM_TIMEOUT_MS = 10_000;

type ErrorResponseBody = {
  code: string;
  error: string;
};

const json = (
  status: number,
  body: ErrorResponseBody | Record<string, unknown>
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

const normalizeUrl = (value: string): string =>
  value.endsWith("/") ? value.slice(0, -1) : value;

const getConvexBaseUrl = (): string | null => {
  const rawUrl = process.env.CONVEX_HTTP_BASE_URL?.trim();
  if (!rawUrl) {
    return null;
  }

  try {
    const parsed = new URL(rawUrl);
    return normalizeUrl(parsed.toString());
  } catch {
    return null;
  }
};

const buildUpstreamUrl = (requestUrl: string, baseUrl: string): string => {
  const incoming = new URL(requestUrl);
  return `${baseUrl}${incoming.pathname}${incoming.search}`;
};

const buildProxyHeaders = (headers: Headers): Headers => {
  const forwardedHeaders = new Headers(headers);
  forwardedHeaders.delete("host");
  // Let upstream decide encoding; we rewrite response bodies locally.
  forwardedHeaders.delete("accept-encoding");
  return forwardedHeaders;
};

const buildClientResponseHeaders = (upstreamHeaders: Headers): Headers => {
  const headers = new Headers(upstreamHeaders);

  // Strip hop-by-hop/transport-specific headers when re-emitting a new body.
  headers.delete("connection");
  headers.delete("keep-alive");
  headers.delete("proxy-authenticate");
  headers.delete("proxy-authorization");
  headers.delete("te");
  headers.delete("trailer");
  headers.delete("transfer-encoding");
  headers.delete("upgrade");
  headers.delete("content-length");
  // Body is reconstructed from decoded text, so encoding metadata is invalid.
  headers.delete("content-encoding");

  return headers;
};

const isJsonResponse = (response: Response): boolean => {
  const contentType = response.headers.get("content-type");
  return contentType?.toLowerCase().includes("application/json") ?? false;
};

const readResponseText = async (response: Response): Promise<string> => {
  return response
    .text()
    .then((value) => value)
    .catch(() => "");
};

const getUpstreamTimeoutMs = (): number => {
  const rawTimeout = process.env.CONVEX_UPSTREAM_TIMEOUT_MS;
  if (!rawTimeout) {
    return DEFAULT_UPSTREAM_TIMEOUT_MS;
  }

  const parsed = Number.parseInt(rawTimeout, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_UPSTREAM_TIMEOUT_MS;
  }

  return parsed;
};

const app = new Hono();

const proxyToConvex = async (request: Request): Promise<Response> => {
  const convexBaseUrl = getConvexBaseUrl();
  if (!convexBaseUrl) {
    return json(500, {
      code: "CONFIG_ERROR",
      error: "Missing or invalid CONVEX_HTTP_BASE_URL",
    });
  }

  const upstreamUrl = buildUpstreamUrl(request.url, convexBaseUrl);
  const headers = buildProxyHeaders(request.headers);
  const timeoutMs = getUpstreamTimeoutMs();
  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => {
    abortController.abort(
      new Error(`Upstream request timed out after ${timeoutMs}ms`)
    );
  }, timeoutMs);

  const body =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : await request.arrayBuffer();

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body,
      signal: abortController.signal,
    });

    if (request.method === "HEAD" || upstreamResponse.status === 204) {
      return new Response(null, {
        status: upstreamResponse.status,
        headers: buildClientResponseHeaders(upstreamResponse.headers),
      });
    }

    const responseText = await readResponseText(upstreamResponse);
    const normalizedResponseText = responseText.trim();

    if (upstreamResponse.ok && !isJsonResponse(upstreamResponse)) {
      return json(502, {
        code: "UPSTREAM_INVALID_RESPONSE",
        error: "Upstream returned an invalid success payload",
      });
    }

    if (upstreamResponse.ok && isJsonResponse(upstreamResponse)) {
      if (!normalizedResponseText) {
        return json(502, {
          code: "UPSTREAM_INVALID_RESPONSE",
          error: "Upstream returned an empty JSON payload",
        });
      }

      try {
        JSON.parse(normalizedResponseText);
      } catch {
        return json(502, {
          code: "UPSTREAM_INVALID_RESPONSE",
          error: "Upstream returned malformed JSON payload",
        });
      }
    }

    return new Response(responseText, {
      status: upstreamResponse.status,
      headers: buildClientResponseHeaders(upstreamResponse.headers),
    });
  } catch {
    if (abortController.signal.aborted) {
      return json(504, {
        code: "UPSTREAM_TIMEOUT",
        error: "Upstream request timed out",
      });
    }

    return json(502, {
      code: "UPSTREAM_UNAVAILABLE",
      error: DEFAULT_PROXY_ERROR,
    });
  } finally {
    clearTimeout(timeoutHandle);
  }
};

app.get("/healthz", (c) => {
  return c.json({
    status: "ok",
    service: "teak-api",
    version: API_VERSION,
  });
});

app.get("/v1", (c) => {
  return c.json({
    version: API_VERSION,
    endpoints: [
      "POST /v1/cards",
      "GET /v1/cards/search",
      "GET /v1/cards/favorites",
      "PATCH /v1/cards/:cardId",
      "DELETE /v1/cards/:cardId",
      "PATCH /v1/cards/:cardId/favorite",
    ],
    auth: "Authorization: Bearer <api_key>",
  });
});

app.post("/v1/cards", (c) => proxyToConvex(c.req.raw));
app.get("/v1/cards/search", (c) => proxyToConvex(c.req.raw));
app.get("/v1/cards/favorites", (c) => proxyToConvex(c.req.raw));
app.on(["PATCH", "DELETE"], "/v1/cards/*", (c) => proxyToConvex(c.req.raw));

app.notFound(() => {
  return json(404, {
    code: "NOT_FOUND",
    error: "Route not found",
  });
});

export default app;
