import { json } from "./http.js";

const DEFAULT_PROXY_ERROR = "Failed to reach upstream API";
const DEFAULT_UPSTREAM_TIMEOUT_MS = 10_000;
const INTERNAL_BASE_URL = "https://api.teakvault.com";

type QueryValue = string | number | boolean | undefined;

export type GatewayOperation = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, QueryValue>;
  headers?: HeadersInit;
  body?: unknown;
};

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
  // Let upstream decide encoding; the gateway reconstructs the body.
  forwardedHeaders.delete("accept-encoding");
  return forwardedHeaders;
};

const buildClientResponseHeaders = (upstreamHeaders: Headers): Headers => {
  const headers = new Headers(upstreamHeaders);

  headers.delete("connection");
  headers.delete("keep-alive");
  headers.delete("proxy-authenticate");
  headers.delete("proxy-authorization");
  headers.delete("te");
  headers.delete("trailer");
  headers.delete("transfer-encoding");
  headers.delete("upgrade");
  headers.delete("content-length");
  headers.delete("content-encoding");

  return headers;
};

const isJsonResponse = (response: Response): boolean => {
  const contentType = response.headers.get("content-type");
  return contentType?.toLowerCase().includes("application/json") ?? false;
};

const readResponseText = (response: Response): Promise<string> => {
  return response.text().catch(() => "");
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

const toGatewayRequestUrl = (
  path: string,
  query: Record<string, QueryValue> | undefined
): string => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(normalizedPath, INTERNAL_BASE_URL);

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) {
      continue;
    }

    url.searchParams.set(key, String(value));
  }

  return url.toString();
};

export const proxyToConvex = async (request: Request): Promise<Response> => {
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

    if (upstreamResponse.ok) {
      if (!isJsonResponse(upstreamResponse)) {
        return json(502, {
          code: "UPSTREAM_INVALID_RESPONSE",
          error: "Upstream returned an invalid success payload",
        });
      }

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

export const executeGatewayOperation = async (
  operation: GatewayOperation
): Promise<Response> => {
  const headers = new Headers(operation.headers);
  const url = toGatewayRequestUrl(operation.path, operation.query);

  let body: string | undefined;
  if (operation.body !== undefined) {
    body = JSON.stringify(operation.body);
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
  }

  const request = new Request(url, {
    method: operation.method,
    headers,
    body,
  });

  return proxyToConvex(request);
};
