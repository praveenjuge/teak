import { httpRouter } from "convex/server";
import { polar } from "./billing";
import { mcpV1, oauthProtectedResourceV1 } from "./mcp/httpServer";
import { duplicateCardV1 } from "./publicApiDuplicate";
import {
  bulkCardsV1,
  cardByIdV1,
  changesCardsV1,
  createCardV1,
  createUploadV1,
  listCardsV1,
  tagsV1,
} from "./publicApiHttp";
import { meV1 } from "./publicApiMe";
import {
  discoveryV1,
  healthzV1,
  teakOAuthClients,
  v1CorsPreflight,
} from "./publicApiMeta";
import { openApiV1 } from "./publicApiOpenApi";
import { safariAccountSummary } from "./safariAccountSummary";
import { disconnectWorkosConsent } from "./workosConnectRevocation";
import { registerWorkosRoutes } from "./workosWebhook";

const http = httpRouter();

http.route({
  path: "/.well-known/teak-oauth-clients.json",
  method: "GET",
  handler: teakOAuthClients,
});
http.route({
  path: "/.well-known/teak-oauth-clients.json",
  method: "OPTIONS",
  handler: v1CorsPreflight,
});

registerWorkosRoutes(http);

http.route({
  path: "/api/safari/account-summary",
  method: "GET",
  handler: safariAccountSummary,
});

// Register the webhook handler at /polar/events
polar.registerRoutes(http as any);

// Register public API v1 routes.
http.route({ path: "/v1/me", method: "GET", handler: meV1 });
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
  "/v1/me",
  "/v1/cards",
  "/v1/uploads",
  "/v1/cards/bulk",
  "/v1/cards/changes",
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
  method: "POST",
  handler: cardByIdV1,
});

http.route({
  pathPrefix: "/v1/cards/",
  method: "DELETE",
  handler: cardByIdV1,
});

http.route({
  path: "/v1/cards/duplicate",
  method: "GET",
  handler: duplicateCardV1,
});
http.route({
  path: "/v1/oauth/disconnect",
  method: "POST",
  handler: disconnectWorkosConsent,
});
http.route({
  path: "/v1/oauth/disconnect",
  method: "OPTIONS",
  handler: v1CorsPreflight,
});

export default http;
