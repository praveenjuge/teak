import { httpRouter } from "convex/server";
import { polar } from "./billing";

const http = httpRouter();

// Register the webhook handler at /polar/events
polar.registerRoutes(http as any);

export default http;