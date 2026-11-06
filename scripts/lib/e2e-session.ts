/**
 * Signs a fresh WorkOS emulator account in against this checkout's running
 * E2E stack, for the native apps' UI flows (apps/apple/scripts/e2e-session.ts,
 * apps/android/scripts/e2e-session.ts).
 */
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import {
  EMULATOR_API_KEY,
  EMULATOR_CLIENT_ID,
} from "../../packages/tests/src/stack/config.ts";
import { currentStack, type StackState } from "./stack-state.ts";

const ROOT = join(import.meta.dir, "../..");

/** The running E2E stack, or an error that says how to start one. */
export const loadE2eStack = (root = ROOT): StackState => {
  const { phase, state } = currentStack(root);
  if (
    phase !== "ready" ||
    state?.mode !== "e2e" ||
    !state.urls.emulatorOrigin
  ) {
    throw new Error(
      "Start the E2E stack first: bun run --cwd packages/tests e2e:stack"
    );
  }
  return state;
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

export interface E2eSession {
  email: string;
  response: { user: { id: string } };
  stack: StackState;
  urls: { appOrigin: string; convexUrl: string; emulatorOrigin: string };
}

export const createSession = async (label: string): Promise<E2eSession> => {
  const stack = loadE2eStack();
  const urls = {
    appOrigin: stack.urls.appOrigin,
    convexUrl: stack.urls.convexUrl,
    emulatorOrigin: stack.urls.emulatorOrigin ?? "",
  };
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
  return { email, response, stack, urls };
};
