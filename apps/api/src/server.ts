import "dotenv/config";
import { serve } from "@hono/node-server";
import app from "./index.js";
import { resolveTeakDevApiUrl } from "./shared/devUrl.js";
import { configureMetrics } from "./shared/metrics.js";

configureMetrics({
  app: "api",
  env: process.env.NODE_ENV ?? "development",
});

const DEFAULT_PORT = 8787;

const resolvePort = (): number => {
  const rawPort = process.env.PORT;
  const parsed = rawPort ? Number.parseInt(rawPort, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PORT;
};

serve(
  {
    fetch: app.fetch,
    port: resolvePort(),
  },
  (info) => {
    const url = process.env.PORTLESS_URL || resolveTeakDevApiUrl(process.env);
    console.log(`teak-api listening on ${url} (upstream port ${info.port})`);
  }
);
