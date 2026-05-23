import { httpRouter } from "convex/server";
import { authComponent, createAuth, trustedOrigins } from "./auth";
import { exchangeNativeAuthOptions, pollNativeAuthCode } from "./authNative";
import { polar } from "./billing";
import { mcpV1 } from "./mcp";
import { discoveryV1, notFound, openApiJson } from "./publicApiDiscovery";
import {
  bulkCardsV1,
  cardByIdV1,
  changesCardsV1,
  createCardV1,
  favoriteCardsV1,
  listCardsV1,
  searchCardsV1,
  tagsV1,
} from "./publicApiHttp";

const http = httpRouter();

// Register the webhook handler at /polar/events
polar.registerRoutes(http as any);

// Register authentication routes with CORS for cross-origin native auth requests.
authComponent.registerRoutesLazy(http, createAuth, {
  cors: true,
  trustedOrigins,
});

http.route({
  path: "/api/native/auth/poll",
  method: "OPTIONS",
  handler: exchangeNativeAuthOptions,
});

http.route({
  path: "/api/native/auth/poll",
  method: "POST",
  handler: pollNativeAuthCode,
});

http.route({
  path: "/v1",
  method: "GET",
  handler: discoveryV1,
});

http.route({
  path: "/openapi.json",
  method: "GET",
  handler: openApiJson,
});

http.route({
  path: "/mcp",
  method: "POST",
  handler: mcpV1,
});

http.route({
  path: "/mcp/",
  method: "POST",
  handler: mcpV1,
});

http.route({
  path: "/v1/cards",
  method: "GET",
  handler: listCardsV1,
});

http.route({
  path: "/v1/cards",
  method: "POST",
  handler: createCardV1,
});

http.route({
  path: "/v1/cards/bulk",
  method: "POST",
  handler: bulkCardsV1,
});

http.route({
  path: "/v1/cards/changes",
  method: "GET",
  handler: changesCardsV1,
});

http.route({
  path: "/v1/cards/search",
  method: "GET",
  handler: searchCardsV1,
});

http.route({
  path: "/v1/cards/favorites",
  method: "GET",
  handler: favoriteCardsV1,
});

http.route({
  path: "/v1/tags",
  method: "GET",
  handler: tagsV1,
});

http.route({
  pathPrefix: "/v1/cards/",
  method: "GET",
  handler: cardByIdV1,
});

http.route({
  pathPrefix: "/v1/cards/",
  method: "PATCH",
  handler: cardByIdV1,
});

http.route({
  pathPrefix: "/v1/cards/",
  method: "DELETE",
  handler: cardByIdV1,
});

for (const method of ["GET", "POST", "PATCH", "DELETE"] as const) {
  http.route({
    pathPrefix: "/",
    method,
    handler: notFound,
  });
}

export default http;
