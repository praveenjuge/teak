import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  readStackState,
  type StackState,
  type StackUrls,
} from "../../../../scripts/lib/stack-state.ts";

type E2eUrls = Required<StackUrls>;

// Hermetic suites (auth-runtime) route every request themselves. They opt in
// with TEAK_E2E_HERMETIC=1 and get origins on a reserved TLD that no real
// server answers, so they never reach a running stack.
export const FIXTURE_URLS: E2eUrls = {
  appOrigin: "http://app.teak-fixture.test",
  apiOrigin: "http://api.teak-fixture.test",
  convexUrl: "http://convex.teak-fixture.test",
  emulatorOrigin: "http://workos.teak-fixture.test",
};

/**
 * Every other suite runs against this checkout's running E2E stack, never the
 * dev stack: that one writes to the shared cloud dev deployment.
 */
export const resolveStackUrls = (
  state: StackState | null,
  hermetic: boolean
): E2eUrls => {
  if (hermetic) {
    return FIXTURE_URLS;
  }
  if (!state) {
    throw new Error(
      "No local stack is running for this checkout. Start one with `bun run --cwd packages/tests e2e:stack`."
    );
  }
  const { emulatorOrigin } = state.urls;
  if (state.mode !== "e2e" || !emulatorOrigin) {
    throw new Error(
      "This checkout runs the dev stack, which uses the shared dev deployment. Stop it with `bun run dev --stop`, then start the E2E stack with `bun run --cwd packages/tests e2e:stack`."
    );
  }
  return { ...state.urls, emulatorOrigin };
};

// Playwright loads this file under Node, so the root comes from import.meta.url.
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

let urls: E2eUrls | undefined;
const current = () => {
  urls ??= resolveStackUrls(
    readStackState(ROOT),
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
