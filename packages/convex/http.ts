import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";
import { polar } from "./billing";

const http = httpRouter();

// Register the webhook handler at /polar/events
polar.registerRoutes(http as any);

// Register authentication routes
authComponent.registerRoutes(http, createAuth);

export default http;
