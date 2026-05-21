import * as Sentry from "@sentry/node";
import { Hono } from "hono";
import { registerMcpRoutes } from "./routes/mcp.js";
import { registerRestRoutes } from "./routes/rest.js";
import { sentryRequestMiddleware } from "./sentry.js";
import { json } from "./shared/http.js";

const app = new Hono();

Sentry.setupHonoErrorHandler(app);

app.use("*", sentryRequestMiddleware);

registerRestRoutes(app);
registerMcpRoutes(app);

app.notFound(() =>
  json(404, {
    code: "NOT_FOUND",
    error: "Route not found",
  })
);

export default app;
