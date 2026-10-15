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
// server answers, so they never reach a running stack. They are HTTPS because
// e2e opens plain HTTP only on loopback hosts; routes answer every request,
// so no TLS handshake ever happens.
export const FIXTURE_URLS: E2eUrls = {
  appOrigin: "https://app.teak-fixture.test",
  apiOrigin: "https://api.teak-fixture.test",
  convexUrl: "https://convex.teak-fixture.test",
  emulatorOrigin: "https://workos.teak-fixture.test",
};

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

// e2e loads this file under Node, so the root comes from import.meta.url.
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/**
 * The web app's origin for the configs' targets. The config loads before any
 * test, so a stack that isn't running yet falls back to the main checkout's
 * port; the tests' own URLs fail with the remedy (see resolveStackUrls).
 */
export const stackAppUrl = (): string =>
  readStackState(ROOT)?.urls.appOrigin ?? "http://localhost:3000";

export const stackMode = () => readStackState(ROOT)?.mode;

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

export const published = {
  siteUrl: "https://teakvault.com",
  appUrl: "https://app.teakvault.com",
  apiUrl: "https://teakvault.com/api",
  mcpUrl: "https://teakvault.com/mcp",
};

export const E2E_PASSWORD = "teak-e2e-Password-1!";

// RFC 2606 reserves example.org, so no real person owns these addresses.
export const uniqueEmail = (label = "primary") =>
  `e2e-${label}-${Date.now()}-${randomBytes(3).toString("hex")}@example.org`;
