import { EDGE_IDENTITY_PATH, WORKFLOW_RPC_PATH } from "@teak/files-protocol";
import { httpRouter } from "convex/server";
import { polar, polarWebhookEvents } from "./billing";
import { edgeIdentityV1 } from "./edgeIdentity";
import { mcpV1, oauthProtectedResourceV1 } from "./mcp/httpServer";
import { duplicateCardV1 } from "./publicApiDuplicate";
import { exportsV1 } from "./publicApiExports";
import {
  bulkCardsV1,
  cardByIdV1,
  changesCardsV1,
  createCardV1,
  createUploadV1,
  folderByIdV1,
  foldersV1,
  listCardsV1,
  tagOperationsV1,
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
import { workflowRpcV1 } from "./workflowGateway";
import { disconnectWorkosConsent } from "./workosConnectRevocation";
import { registerWorkosRoutes } from "./workosWebhook";

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

polar.registerRoutes(http, { events: polarWebhookEvents });

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
  "/v1/tags/rename",
  "/v1/tags/merge",
  "/v1/tags/delete",
  "/v1/folders",
  "/v1/exports",
  "/v1/exports/latest",
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

http.route({
  pathPrefix: "/v1/folders/",
  method: "OPTIONS",
  handler: v1CorsPreflight,
});

http.route({
  pathPrefix: "/v1/tags/operations/",
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

for (const path of ["/v1/tags/rename", "/v1/tags/merge", "/v1/tags/delete"]) {
  http.route({ path, method: "POST", handler: tagOperationsV1 });
}

http.route({
  pathPrefix: "/v1/tags/operations/",
  method: "GET",
  handler: tagOperationsV1,
});

for (const method of ["GET", "POST"] as const) {
  http.route({ path: "/v1/folders", method, handler: foldersV1 });
}

for (const method of ["GET", "PATCH", "POST", "DELETE"] as const) {
  http.route({ pathPrefix: "/v1/folders/", method, handler: folderByIdV1 });
}

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
  pathPrefix: "/v1/cards/",
  method: "PUT",
  handler: cardByIdV1,
});

http.route({
  path: "/v1/cards/duplicate",
  method: "GET",
  handler: duplicateCardV1,
});
http.route({ path: "/v1/exports", method: "POST", handler: exportsV1 });
http.route({ path: "/v1/exports/latest", method: "GET", handler: exportsV1 });
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
