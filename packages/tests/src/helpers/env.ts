import { randomBytes } from "node:crypto";
import { readStackState, type StackState } from "../stack/config";

// Hermetic suites (auth-runtime) route every request themselves. They opt in
// with TEAK_E2E_HERMETIC=1 and get origins on a reserved TLD that no real
// server answers, so they never reach a running stack.
export const FIXTURE_URLS: StackState["urls"] = {
  appOrigin: "http://app.teak-fixture.test",
  apiOrigin: "http://api.teak-fixture.test",
  convexUrl: "http://convex.teak-fixture.test",
  emulatorOrigin: "http://workos.teak-fixture.test",
};

/** Every other suite runs against this checkout's running stack. */
export const resolveStackUrls = (
  state: StackState | null,
  hermetic: boolean
): StackState["urls"] => {
  if (hermetic) {
    return FIXTURE_URLS;
  }
  if (!state) {
    throw new Error(
      "No local stack is running for this checkout. Start one with `bun run --cwd packages/tests e2e:stack`."
    );
  }
  return state.urls;
};

let urls: StackState["urls"] | undefined;
const current = () => {
  urls ??= resolveStackUrls(
    readStackState(),
    process.env.TEAK_E2E_HERMETIC === "1"
  );
  return urls;
};

export const env = {
  get appUrl() {
    return current().appOrigin;
  },
  get apiUrl() {
    return current().apiOrigin;
  },
  get convexUrl() {
    return current().convexUrl;
  },
  get mcpUrl() {
    return `${current().apiOrigin}/mcp`;
  },
  get emulatorUrl() {
    return current().emulatorOrigin;
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
