import type { Hono } from "hono";
import { openApiSpec } from "../openapi.js";
import { proxyToConvex } from "../shared/proxy.js";
import {
  API_AUTH_HINT,
  API_VERSION,
  getMcpEndpointFromRequestUrl,
  MCP_TRANSPORT,
  V1_ENDPOINTS,
} from "../shared/v1.js";

const REST_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Idempotency-Key, X-Request-Id",
  "Access-Control-Expose-Headers":
    "X-Request-Id, Idempotency-Key, RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Retry-After",
  "Access-Control-Max-Age": "86400",
};

const corsPreflight = (): Response =>
  new Response(null, { status: 204, headers: REST_CORS_HEADERS });

export const registerRestRoutes = (app: Hono): void => {
  app.get("/healthz", (c) =>
    c.json({
      status: "ok",
      service: "teak-api",
      version: API_VERSION,
    })
  );

  app.get("/v1", (c) =>
    c.json({
      version: API_VERSION,
      endpoints: V1_ENDPOINTS,
      auth: API_AUTH_HINT,
      mcp: {
        endpoint: getMcpEndpointFromRequestUrl(c.req.url),
        transport: MCP_TRANSPORT,
        auth: API_AUTH_HINT,
      },
    })
  );

  app.get("/openapi.json", (c) => c.json(openApiSpec));

  app.options("/v1", corsPreflight);
  app.options("/v1/*", corsPreflight);

  app.get("/v1/cards", (c) => proxyToConvex(c.req.raw));
  app.post("/v1/cards", (c) => proxyToConvex(c.req.raw));
  app.post("/v1/cards/bulk", (c) => proxyToConvex(c.req.raw));
  app.get("/v1/cards/changes", (c) => proxyToConvex(c.req.raw));
  app.get("/v1/cards/search", (c) => proxyToConvex(c.req.raw));
  app.get("/v1/cards/favorites", (c) => proxyToConvex(c.req.raw));
  app.get("/v1/tags", (c) => proxyToConvex(c.req.raw));
  app.on(["GET", "PATCH", "DELETE"], "/v1/cards/*", (c) =>
    proxyToConvex(c.req.raw)
  );
};
