import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";
import { exchangeDesktopAuthOptions, pollDesktopAuthCode } from "./authDesktop";
import { polar } from "./billing";
import {
  bulkCardsV1,
  cardByIdV1,
  changesCardsV1,
  createCardV1,
  favoriteCards,
  favoriteCardsV1,
  listCardsV1,
  quickSave,
  searchCards,
  searchCardsV1,
  tagsV1,
} from "./raycastHttp";

const http = httpRouter();

// Register the webhook handler at /polar/events
polar.registerRoutes(http as any);

// Register authentication routes with CORS for cross-origin desktop auth requests.
authComponent.registerRoutes(http, createAuth, {
  cors: true,
});

http.route({
  path: "/api/desktop/auth/poll",
  method: "OPTIONS",
  handler: exchangeDesktopAuthOptions,
});

http.route({
  path: "/api/desktop/auth/poll",
  method: "POST",
  handler: pollDesktopAuthCode,
});

// Register Raycast API routes
http.route({
  path: "/api/raycast/quick-save",
  method: "POST",
  handler: quickSave,
});

http.route({
  path: "/api/raycast/search",
  method: "GET",
  handler: searchCards,
});

http.route({
  path: "/api/raycast/favorites",
  method: "GET",
  handler: favoriteCards,
});

// Register public API v1 routes (used by apps/api proxy).
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

export default http;
