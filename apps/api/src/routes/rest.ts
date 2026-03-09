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

export const registerRestRoutes = (app: Hono): void => {
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
      endpoints: V1_ENDPOINTS,
      auth: API_AUTH_HINT,
      mcp: {
        endpoint: getMcpEndpointFromRequestUrl(c.req.url),
        transport: MCP_TRANSPORT,
        auth: API_AUTH_HINT,
      },
    });
  });

  app.get("/openapi.json", (c) => c.json(openApiSpec));

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
