import type { Hono } from "hono";
import { cors } from "hono/cors";
import { openApiSpec } from "../openapi.js";
import { proxyToConvex } from "../shared/proxy.js";
import {
  API_AUTH_HINT,
  API_VERSION,
  getMcpEndpointFromRequestUrl,
  MCP_TRANSPORT,
  V1_ENDPOINTS,
} from "../shared/v1.js";

// Public REST clients can call the gateway from any origin (browser extensions,
// third-party web apps). Applying the CORS middleware ahead of the route
// handlers answers preflight `OPTIONS` requests AND attaches
// `Access-Control-Allow-Origin`/expose headers to the actual proxied responses,
// so cross-origin browsers can read the payload instead of only clearing the
// preflight.
const restCors = cors({
  origin: "*",
  allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: [
    "Content-Type",
    "Authorization",
    "Idempotency-Key",
    "X-Request-Id",
  ],
  exposeHeaders: [
    "X-Request-Id",
    "Idempotency-Key",
    "RateLimit-Limit",
    "RateLimit-Remaining",
    "RateLimit-Reset",
    "Retry-After",
  ],
  maxAge: 86_400,
});

export const registerRestRoutes = (app: Hono): void => {
  app.use("/v1", restCors);
  app.use("/v1/*", restCors);

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

  app.get("/v1/cards", (c) => proxyToConvex(c.req.raw));
  app.post("/v1/cards", (c) => proxyToConvex(c.req.raw));
  app.post("/v1/uploads", (c) => proxyToConvex(c.req.raw));
  app.post("/v1/cards/bulk", (c) => proxyToConvex(c.req.raw));
  app.get("/v1/cards/changes", (c) => proxyToConvex(c.req.raw));
  app.get("/v1/cards/search", (c) => proxyToConvex(c.req.raw));
  app.get("/v1/cards/favorites", (c) => proxyToConvex(c.req.raw));
  app.get("/v1/tags", (c) => proxyToConvex(c.req.raw));
  app.on(["GET", "PATCH", "DELETE"], "/v1/cards/*", (c) =>
    proxyToConvex(c.req.raw)
  );
};
