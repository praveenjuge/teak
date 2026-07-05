import { httpRouter } from "convex/server";
import { authComponent, createAuth, trustedOrigins } from "./auth";
import {
  oauthSessionExchange,
  oauthSessionExchangeOptions,
} from "./authDesktopOauth";
import { exchangeNativeAuthOptions, pollNativeAuthCode } from "./authNative";
import { polar } from "./billing";
import { mcpV1, oauthProtectedResourceV1 } from "./mcp/httpServer";
import { healthzV1, discoveryV1, v1CorsPreflight } from "./publicApiMeta";
import {
  bulkCardsV1,
  cardByIdV1,
  changesCardsV1,
  createCardV1,
  createUploadV1,
  favoriteCardsV1,
  listCardsV1,
  searchCardsV1,
  tagsV1,
} from "./publicApiHttp";
import { openApiV1 } from "./publicApiOpenApi";

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

// Desktop OAuth -> dedicated session exchange (single-use access token).
http.route({
  path: "/api/native/auth/oauth-exchange",
  method: "OPTIONS",
  handler: oauthSessionExchangeOptions,
});

http.route({
  path: "/api/native/auth/oauth-exchange",
  method: "POST",
  handler: oauthSessionExchange,
});

// Register public API v1 routes.
http.route({
  path: "/healthz",
  method: "GET",
  handler: healthzV1,
});

http.route({
  path: "/v1",
  method: "GET",
  handler: discoveryV1,
});

http.route({
  path: "/v1",
  method: "OPTIONS",
  handler: discoveryV1,
});

http.route({
  path: "/openapi.json",
  method: "GET",
  handler: openApiV1,
});

for (const path of [
  "/v1/cards",
  "/v1/uploads",
  "/v1/cards/bulk",
  "/v1/cards/changes",
  "/v1/cards/search",
  "/v1/cards/favorites",
  "/v1/tags",
]) {
  http.route({
    path,
    method: "OPTIONS",
    handler: v1CorsPreflight,
  });
}

http.route({
  pathPrefix: "/v1/cards/",
  method: "OPTIONS",
  handler: v1CorsPreflight,
});

for (const path of ["/mcp", "/mcp/"]) {
  for (const method of ["GET", "POST", "DELETE", "OPTIONS"] as const) {
    http.route({
      path,
      method,
      handler: mcpV1,
    });
  }
}

for (const path of [
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/mcp",
]) {
  http.route({
    path,
    method: "GET",
    handler: oauthProtectedResourceV1,
  });
  http.route({
    path,
    method: "OPTIONS",
    handler: oauthProtectedResourceV1,
  });
}

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
  path: "/v1/uploads",
  method: "POST",
  handler: createUploadV1,
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

export default http;
