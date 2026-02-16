import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";
import { exchangeDesktopAuthOptions, pollDesktopAuthCode } from "./authDesktop";
import { polar } from "./billing";
import { favoriteCards, quickSave, searchCards } from "./raycastHttp";

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

export default http;
