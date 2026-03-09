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
