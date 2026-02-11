import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";
import { polar } from "./billing";
import { favoriteCards, quickSave, searchCards } from "./raycastHttp";

const http = httpRouter();

// Register the webhook handler at /polar/events
polar.registerRoutes(http as any);

// Register authentication routes
authComponent.registerRoutes(http, createAuth);

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

export default http;
