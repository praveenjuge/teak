import { Hono } from "hono";
import { registerMcpRoutes } from "./routes/mcp.js";
import { registerRestRoutes } from "./routes/rest.js";
import { json } from "./shared/http.js";

const app = new Hono();

app.use("*", async (c, next) => {
  const requestId = crypto.randomUUID();
  await next();
  c.res.headers.set("X-Request-Id", requestId);
});

registerRestRoutes(app);
registerMcpRoutes(app);

app.notFound(() => {
  return json(404, {
    code: "NOT_FOUND",
    error: "Route not found",
  });
});

export default app;
