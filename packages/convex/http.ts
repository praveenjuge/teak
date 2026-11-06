import { EDGE_IDENTITY_PATH, WORKFLOW_RPC_PATH } from "@teak/files-protocol";
import { httpRouter, type PublicHttpAction } from "convex/server";
import { polar, polarWebhookEvents } from "./billing";
import { edgeIdentityV1 } from "./edgeIdentity";
import { registerInboundRoutes } from "./inbound/http";
import { mcpV1, oauthProtectedResourceV1 } from "./mcp/httpServer";
import {
  discoveryV1,
  healthzV1,
  teakOAuthClients,
  v1CorsPreflight,
} from "./publicApi/http/meta";
import {
  publicApiV1,
  type StandaloneOperationId,
} from "./publicApi/http/router";
import { openApiV1 } from "./publicApi/openApi/spec";
import {
  OAUTH_PROTECTED_RESOURCE_PATHS,
  PUBLIC_API_OPERATION_IDS,
  PUBLIC_API_OPERATIONS,
  TEAK_OAUTH_CLIENTS_PATH,
} from "./shared/publicApiContract";
import { workflowRpcV1 } from "./workflowGateway";
import { disconnectWorkosConsent } from "./workos/connectRevocation";

const http = httpRouter();

http.route({
  path: EDGE_IDENTITY_PATH,
  method: "POST",
  handler: edgeIdentityV1,
});

http.route({
  path: WORKFLOW_RPC_PATH,
  method: "POST",
  handler: workflowRpcV1,
});

http.route({
  path: TEAK_OAUTH_CLIENTS_PATH,
  method: "GET",
  handler: teakOAuthClients,
});
http.route({
  path: TEAK_OAUTH_CLIENTS_PATH,
  method: "OPTIONS",
  handler: v1CorsPreflight,
});

registerInboundRoutes(http);

polar.registerRoutes(http, { events: polarWebhookEvents });

const STANDALONE_ROUTES: Record<StandaloneOperationId, PublicHttpAction> = {
  disconnectOAuthConsent: disconnectWorkosConsent,
  getApiDiscovery: discoveryV1,
  getHealth: healthzV1,
};

// An operation at a fixed path gets its own route. The router tries exact
// paths first, then the longest prefix, so the `/v1/` routes below take the
// operations with path parameters, and answer the API's JSON 404 or 405 (with
// CORS headers) for anything no operation takes.
for (const id of PUBLIC_API_OPERATION_IDS) {
  const { method, path } = PUBLIC_API_OPERATIONS[id];
  if (!path.includes("{")) {
    http.route({
      path,
      method,
      handler:
        (STANDALONE_ROUTES as Partial<Record<string, PublicHttpAction>>)[id] ??
        publicApiV1,
    });
  }
}
for (const method of ["GET", "POST", "PATCH", "PUT", "DELETE"] as const) {
  http.route({ pathPrefix: "/v1/", method, handler: publicApiV1 });
}
http.route({ path: "/v1", method: "OPTIONS", handler: discoveryV1 });
http.route({ pathPrefix: "/v1/", method: "OPTIONS", handler: v1CorsPreflight });

http.route({ path: "/openapi.json", method: "GET", handler: openApiV1 });

for (const path of ["/mcp", "/mcp/"]) {
  for (const method of ["GET", "POST", "DELETE", "OPTIONS"] as const) {
    http.route({ path, method, handler: mcpV1 });
  }
}

for (const path of OAUTH_PROTECTED_RESOURCE_PATHS) {
  for (const method of ["GET", "OPTIONS"] as const) {
    http.route({ path, method, handler: oauthProtectedResourceV1 });
  }
}

export default http;
