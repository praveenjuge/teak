import { expect } from "@playwright/test";
import { EMULATOR_API_KEY, EMULATOR_CLIENT_ID } from "../emulator/config";
import { env } from "./env";

// The WorkOS emulator's own API: the suite's stand-in for the WorkOS
// dashboard and for the inbox that would receive emailed codes.

export interface EmulatorUser {
  email: string;
  email_verified: boolean;
  id: string;
}

const emulatorFetch = async (path: string, init: RequestInit = {}) => {
  // The origin is the fixed local emulator; tests pass only literal paths.
  // nosemgrep: rules_lgpl_javascript_ssrf_rule-node-ssrf
  const response = await fetch(new URL(path, env.emulatorUrl), {
    ...init,
    headers: {
      Authorization: `Bearer ${EMULATOR_API_KEY}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok) {
    throw new Error(
      `WorkOS emulator ${init.method ?? "GET"} ${path} failed: ${response.status}`
    );
  }
  return response;
};

// Creating the user sends a signed user.created webhook to the local backend,
// which is what gives the address a Teak account.
export const createEmulatorUser = async (options: {
  email: string;
  emailVerified: boolean;
  password: string;
}): Promise<EmulatorUser> =>
  (
    await emulatorFetch("/user_management/users", {
      method: "POST",
      body: JSON.stringify({
        email: options.email,
        email_verified: options.emailVerified,
        first_name: "Teak",
        last_name: "Test",
        password: options.password,
      }),
    })
  ).json();

export const findEmulatorUser = async (
  email: string
): Promise<EmulatorUser | null> => {
  const response = await emulatorFetch(
    `/user_management/users?email=${encodeURIComponent(email)}`
  );
  const { data } = (await response.json()) as { data: EmulatorUser[] };
  return data[0] ?? null;
};

// Codes WorkOS would email are recorded as events. Newest events come first.
export const waitForEmailedEvent = async <T extends { email: string }>(
  event:
    | "email_verification.created"
    | "magic_auth.created"
    | "password_reset.created",
  email: string
): Promise<T> => {
  let found: T | undefined;
  await expect
    .poll(
      async () => {
        const response = await emulatorFetch(
          `/events?events[]=${encodeURIComponent(event)}&limit=100`
        );
        const { data } = (await response.json()) as {
          data: Array<{ data: T }>;
        };
        found = data.find((item) => item.data.email === email)?.data;
        return Boolean(found);
      },
      { message: `${event} for the test account`, timeout: 15_000 }
    )
    .toBe(true);
  return found as T;
};

// The reset email's payload. The token is minted by the emulator per run.
interface PasswordResetEvent {
  email: string;
  // nosemgrep: codacy.yaml.security.hard-coded-tokens
  password_reset_token: string;
}

export const resetPasswordThroughEmail = async (
  email: string,
  password: string
) => {
  await emulatorFetch("/user_management/password_reset", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
  const reset = await waitForEmailedEvent<PasswordResetEvent>(
    "password_reset.created",
    email
  );
  await emulatorFetch("/user_management/password_reset/confirm", {
    method: "POST",
    body: JSON.stringify({
      new_password: password,
      // nosemgrep: codacy.yaml.security.hard-coded-tokens
      token: reset.password_reset_token,
    }),
  });
};

// The emulator mints this token per run.
interface SessionResponse {
  // nosemgrep: codacy.yaml.security.hard-coded-tokens
  access_token: string;
}

// A session token for direct Convex calls, from the same password grant the
// hosted login page uses. The backend trusts it exactly like a browser's.
export const sessionTokenFor = async (email: string, password: string) => {
  const response = await emulatorFetch("/user_management/authenticate", {
    method: "POST",
    body: JSON.stringify({
      client_id: EMULATOR_CLIENT_ID,
      client_secret: EMULATOR_API_KEY,
      email,
      grant_type: "password",
      password,
    }),
  });
  const session = (await response.json()) as SessionResponse;
  return session.access_token;
};
