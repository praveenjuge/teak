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

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export const loopbackUrl = (path: string, origin: string) => {
  const url = new URL(path, origin);
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(
      `The E2E emulator must run on this machine, not ${url.hostname}`
    );
  }
  return url;
};

const emulator = async (origin: string, path: string, body: unknown) => {
  const response = await fetch(loopbackUrl(path, origin), {
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
