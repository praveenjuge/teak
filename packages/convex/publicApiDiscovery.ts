import { httpAction } from "./_generated/server";
import { resolveTeakDevApiUrl } from "./devUrls";
import { openApiSpec } from "./openapi";
import { errorResponse, json } from "./publicApiHttp";

export const API_VERSION = "v1";

export const V1_ENDPOINTS = [
  "GET /v1/cards",
  "POST /v1/cards",
  "POST /v1/cards/bulk",
  "GET /v1/cards/changes",
  "GET /v1/cards/search",
  "GET /v1/cards/favorites",
  "GET /v1/cards/:cardId",
  "PATCH /v1/cards/:cardId",
  "DELETE /v1/cards/:cardId",
  "PATCH /v1/cards/:cardId/favorite",
  "GET /v1/tags",
] as const;

export const API_AUTH_HINT = "Authorization: Bearer <api_key>";
export const MCP_TRANSPORT = "streamable-http";

export const getMcpEndpointFromRequestUrl = (requestUrl: string): string => {
  const incoming = new URL(requestUrl);
  return `${incoming.origin}/mcp`;
};

export const discoveryV1 = httpAction(async (_ctx, request) => {
  if (request.method !== "GET") {
    return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
  }

  return json(200, {
    version: API_VERSION,
    endpoints: V1_ENDPOINTS,
    auth: API_AUTH_HINT,
    mcp: {
      endpoint: getMcpEndpointFromRequestUrl(request.url),
      transport: MCP_TRANSPORT,
      auth: API_AUTH_HINT,
    },
  });
});

export const openApiJson = httpAction(async (_ctx, request) => {
  if (request.method !== "GET") {
    return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
  }

  return json(200, openApiSpec);
});

export const notFound = httpAction(async () =>
  errorResponse(404, "NOT_FOUND", "Route not found")
);

export const getOpenApiLocalServerUrl = (): string =>
  resolveTeakDevApiUrl(process.env);
