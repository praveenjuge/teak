import "dotenv/config";
import { serve } from "@hono/node-server";
import app from "./index.js";

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
    console.log(`teak-api listening on http://localhost:${info.port}`);
  }
);
