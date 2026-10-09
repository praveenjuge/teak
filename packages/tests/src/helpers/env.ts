import { randomBytes } from "node:crypto";
import { readStackState } from "../stack/config";

// The suite runs against this checkout's running stack, which records its
// URLs when it starts (src/scripts/run-local-suite.ts, or `bun run dev`).
// Only the published-site `docs` project runs without one.
const stack = readStackState();
const missing = () => {
  throw new Error(
    "No local stack is running for this checkout. Start one with `bun run --cwd packages/tests e2e:stack`."
  );
};

export const env = {
  get appUrl() {
    return stack?.urls.appOrigin ?? missing();
  },
  get apiUrl() {
    return stack?.urls.apiOrigin ?? missing();
  },
  get convexUrl() {
    return stack?.urls.convexUrl ?? missing();
  },
  get mcpUrl() {
    return `${stack?.urls.apiOrigin ?? missing()}/mcp`;
  },
  get emulatorUrl() {
    return stack?.urls.emulatorOrigin ?? missing();
  },
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
