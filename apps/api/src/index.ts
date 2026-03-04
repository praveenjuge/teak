import { Hono } from "hono";
import { registerMcpRoutes } from "./routes/mcp.js";
import { registerRestRoutes } from "./routes/rest.js";
import { json } from "./shared/http.js";

const app = new Hono();

registerRestRoutes(app);
registerMcpRoutes(app);

app.notFound(() => {
  return json(404, {
    code: "NOT_FOUND",
    error: "Route not found",
  });
});

export default app;
