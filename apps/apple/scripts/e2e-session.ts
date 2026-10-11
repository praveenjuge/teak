/**
 * A signed-in session for the Apple app against this checkout's local E2E
 * stack (`bun run --cwd packages/tests e2e:stack`), without a browser.
 *
 * Creates a throwaway, verified WorkOS emulator user (which gives it a Teak
 * vault through the emulator's webhook), signs in with the password grant,
 * and prints the launch environment a Debug build reads:
 *
 *   bun --no-env-file run apps/apple/scripts/e2e-session.ts
 *
 * Everything here exists only in the emulator's memory; nothing reaches
 * hosted WorkOS or the shared dev deployment.
 */
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  EMULATOR_API_KEY,
  EMULATOR_CLIENT_ID,
} from "../../../packages/tests/src/stack/config";

const statePath = resolve(
  import.meta.dir,
  "../../../.agents/.state/stack.json"
);

export const loadStack = async () => {
  const state = JSON.parse(await readFile(statePath, "utf8")) as {
    mode?: string;
    ready?: boolean;
    urls: { appOrigin: string; convexUrl: string; emulatorOrigin: string };
  };
  if (state.mode !== "e2e" || !state.ready) {
    throw new Error(
      "Start the E2E stack first: bun run --cwd packages/tests e2e:stack"
    );
  }
  return state.urls;
};

const emulator = async (origin: string, path: string, body: unknown) => {
  // The origin is the local WorkOS emulator from this checkout's stack.json.
  // nosemgrep: rules_lgpl_javascript_ssrf_rule-node-ssrf
  const response = await fetch(new URL(path, origin), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${EMULATOR_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Emulator ${path} failed: ${response.status}`);
  }
  return response.json();
};

/** A new vault and a WorkOS authenticate response for it. */
export const createSession = async (label = "apple") => {
  const urls = await loadStack();
  const email = `e2e-${label}-${Date.now()}-${randomBytes(4).toString("hex")}@example.org`;
  const password = `Teak-${randomBytes(12).toString("hex")}-Aa1`;
  await emulator(urls.emulatorOrigin, "/user_management/users", {
    email,
    email_verified: true,
    first_name: "Teak",
    last_name: "Test",
    password,
  });
  const response = await emulator(
    urls.emulatorOrigin,
    "/user_management/authenticate",
    {
      client_id: EMULATOR_CLIENT_ID,
      client_secret: EMULATOR_API_KEY,
      email,
      grant_type: "password",
      password,
    }
  );
  return { urls, email, response };
};

/** The environment a Debug build of the app reads at launch. */
export const launchEnvironment = (
  session: Awaited<ReturnType<typeof createSession>>
) => ({
  TeakConvexURL: session.urls.convexUrl,
  TeakWorkOSURL: session.urls.emulatorOrigin,
  TeakWebURL: session.urls.appOrigin,
  TeakEnvironment: "e2e",
  TEAK_UI_TEST_CLIENT_ID: EMULATOR_CLIENT_ID,
  TEAK_UI_TEST_SESSION: Buffer.from(JSON.stringify(session.response)).toString(
    "base64"
  ),
});

if (import.meta.main) {
  const session = await createSession();
  for (const [key, value] of Object.entries(launchEnvironment(session))) {
    console.log(`${key}=${value}`);
  }
}
