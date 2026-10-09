/**
 * Headless WorkOS AuthKit session for tests against a local or CI web app,
 * through WorkOS staging or the local WorkOS emulator.
 *
 * Creates a throwaway, already-verified WorkOS user with a random password,
 * signs in with the password grant, and seals the tokens into the session
 * cookie exactly as @workos-inc/authkit-nextjs 4.4 does after its callback
 * (iron-session `sealData` with the web's WORKOS_COOKIE_PASSWORD and ttl 0,
 * cookie `wos-session`). Callers must always run `cleanup()`, which deletes
 * the WorkOS user. Nothing here logs emails, passwords, tokens, or cookies.
 */

import { randomBytes } from "node:crypto";
import { type AuthenticationResponse, WorkOS } from "@workos-inc/node";
import { sealData } from "iron-session";

/** authkit-nextjs default; Teak does not set WORKOS_COOKIE_NAME. */
export const WORKOS_SESSION_COOKIE_NAME = "wos-session";

/**
 * RFC 2606 reserves example.org, so no real person can own these addresses.
 * Not example.com: WorkOS's default test organization claims it and requires
 * SSO, which refuses password sign-in. The `e2e-` prefix marks the address as
 * a test account.
 */
export const TEST_SESSION_EMAIL_DOMAIN = "example.org";

export interface WorkosTestSessionOptions {
  /**
   * Sign in as this existing account, such as the local stack's seeded dev
   * account, instead of creating a throwaway user. Cleanup then does nothing.
   */
  account?: { email: string; password: string };
  /**
   * A WorkOS API other than api.workos.com, such as the local emulator: the
   * web's WORKOS_API_HOSTNAME, WORKOS_API_PORT and WORKOS_API_HTTPS.
   */
  api?: { hostname: string; https: boolean; port?: number };
  apiKey: string;
  clientId: string;
  /** The web server's WORKOS_COOKIE_PASSWORD (at least 32 characters). */
  cookiePassword: string;
  /** Short label for the address, e.g. "smoke" -> e2e-smoke-…@example.org. */
  label?: string;
  /** The web's NEXT_PUBLIC_WORKOS_REDIRECT_URI; decides the Secure flag. */
  redirectUri: string;
}

export interface WorkosTestSessionCookie {
  name: string;
  options: {
    httpOnly: true;
    maxAge: number;
    path: "/";
    sameSite: "lax";
    secure: boolean;
  };
  value: string;
}

export interface WorkosTestSession {
  /** Deletes the WorkOS user. Safe to call more than once. */
  cleanup: () => Promise<void>;
  cookie: WorkosTestSessionCookie;
  email: string;
  userId: string;
}

// authkit-nextjs keeps the session cookie for 400 days (Chrome's maximum);
// the access and refresh tokens are what expire.
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 400;

export const testSessionEmail = (label = "session"): string =>
  `e2e-${label}-${Date.now()}-${randomBytes(4).toString("hex")}@${TEST_SESSION_EMAIL_DOMAIN}`;

/** `Cookie` request header for the session, e.g. for fetch. */
export const cookieHeader = (cookie: WorkosTestSessionCookie): string =>
  `${cookie.name}=${cookie.value}`;

/**
 * Error summary safe for CI logs: class name, HTTP status and an
 * identifier-shaped WorkOS error code only, never the message (which can
 * echo request values).
 */
export const describeWorkosError = (error: unknown): string => {
  if (!(error instanceof Error)) {
    return "unknown error";
  }
  const { status, code } = error as { code?: unknown; status?: unknown };
  const parts = [/^[A-Za-z]{1,64}$/.test(error.name) ? error.name : "Error"];
  if (typeof status === "number") {
    parts.push(String(status));
  }
  if (typeof code === "string" && /^[a-z][a-z0-9_]{0,63}$/i.test(code)) {
    parts.push(`(${code})`);
  }
  return parts.join(" ");
};

/** Seals tokens the way authkit-nextjs saves a session after its callback. */
export const sealSessionCookie = async (
  auth: Pick<
    AuthenticationResponse,
    | "accessToken"
    | "authenticationMethod"
    | "impersonator"
    | "refreshToken"
    | "user"
  >,
  options: Pick<WorkosTestSessionOptions, "cookiePassword" | "redirectUri">
): Promise<WorkosTestSessionCookie> => ({
  name: WORKOS_SESSION_COOKIE_NAME,
  value: await sealData(
    {
      accessToken: auth.accessToken,
      refreshToken: auth.refreshToken,
      user: auth.user,
      impersonator: auth.impersonator,
      authenticationMethod: auth.authenticationMethod,
    },
    { password: options.cookiePassword, ttl: 0 }
  ),
  options: {
    httpOnly: true,
    maxAge: COOKIE_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: new URL(options.redirectUri).protocol === "https:",
  },
});

export const createWorkosTestSession = async (
  options: WorkosTestSessionOptions
): Promise<WorkosTestSession> => {
  if (options.cookiePassword.length < 32) {
    throw new Error("WORKOS_COOKIE_PASSWORD must be at least 32 characters");
  }
  const workos = new WorkOS(options.apiKey, {
    clientId: options.clientId,
    ...(options.api
      ? {
          apiHostname: options.api.hostname,
          https: options.api.https,
          ...(options.api.port ? { port: options.api.port } : {}),
        }
      : {}),
  });
  if (options.account) {
    const auth = await workos.userManagement.authenticateWithPassword({
      clientId: options.clientId,
      ...options.account,
    });
    return {
      cleanup: async () => undefined,
      cookie: await sealSessionCookie(auth, options),
      email: options.account.email,
      userId: auth.user.id,
    };
  }
  const email = testSessionEmail(options.label);
  // Random per run and never stored: 32 random characters plus every class.
  const password = `${randomBytes(24).toString("base64url")}aA1!`;
  const user = await workos.userManagement.createUser({
    email,
    password,
    emailVerified: true,
    firstName: "Teak",
    lastName: "Test",
  });
  let deleted = false;
  const cleanup = async () => {
    if (deleted) {
      return;
    }
    await workos.userManagement.deleteUser(user.id);
    deleted = true;
  };
  try {
    const auth = await workos.userManagement.authenticateWithPassword({
      clientId: options.clientId,
      email,
      password,
    });
    return {
      cleanup,
      cookie: await sealSessionCookie(auth, options),
      email,
      userId: user.id,
    };
  } catch (error) {
    await cleanup().catch(() => undefined);
    throw error;
  }
};
