import { randomBytes } from "node:crypto";
import {
  EMULATOR_ORIGIN,
  LOCAL_API_ORIGIN,
  LOCAL_APP_ORIGIN,
  LOCAL_CONVEX_URL,
} from "../emulator/config";

// The suite always runs against the fixed local stack; see
// src/scripts/run-local-suite.ts.
export const env = {
  appUrl: LOCAL_APP_ORIGIN,
  apiUrl: LOCAL_API_ORIGIN,
  convexUrl: LOCAL_CONVEX_URL,
  mcpUrl: `${LOCAL_API_ORIGIN}/mcp`,
  emulatorUrl: EMULATOR_ORIGIN,
};

// The docs checks read the published site and Teak's public production
// endpoints with unauthenticated GETs, and never the local stack.
export const published = {
  siteUrl: "https://teakvault.com",
  appUrl: "https://app.teakvault.com",
  apiUrl: "https://teakvault.com/api",
  mcpUrl: "https://teakvault.com/mcp",
};

// Emulator accounts exist only in its memory, so one known password is fine.
export const E2E_PASSWORD = "teak-e2e-Password-1!";

// RFC 2606 reserves example.org, so no real person owns these addresses.
export const uniqueEmail = (label = "primary") =>
  `e2e-${label}-${Date.now()}-${randomBytes(3).toString("hex")}@example.org`;
