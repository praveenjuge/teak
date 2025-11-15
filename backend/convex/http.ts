import { httpRouter } from "convex/server";
import { polar } from "./billing";
import { authComponent, createAuth } from "./auth";

const http = httpRouter();

// Register the webhook handler at /polar/events
polar.registerRoutes(http as any);

// Register authentication routes
authComponent.registerRoutes(http, createAuth);

export default http;