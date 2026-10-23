import "server-only";
import { api } from "@teak/convex";
import { ConvexHttpClient } from "convex/browser";
import { getConvexUrl } from "./public-env";

// Long enough for a sign-up that just finished on the hosted page, short
// enough that a returning user's sign-in never waits on Convex.
const NEW_ACCOUNT_WINDOW_MS = 10 * 60 * 1000;
const BOOTSTRAP_TIMEOUT_MS = 4000;

type Bootstrap =
  | { status: "ok"; teakUserId: string }
  | { status: "verify_email" | "frozen" }
  | { status: "quarantined"; reason: string };

/**
 * Creates a brand-new account's Teak user while the callback still holds the
 * fresh access token, so the first page load finds it instead of the browser
 * creating it after the app starts. Best effort: on any failure or timeout
 * the browser bootstraps as before.
 */
export async function bootstrapNewAccount(
  user: { createdAt: string },
  accessToken: string,
  now = Date.now()
): Promise<Bootstrap | null> {
  if (!(now - Date.parse(user.createdAt) < NEW_ACCOUNT_WINDOW_MS)) {
    return null;
  }
  const client = new ConvexHttpClient(getConvexUrl());
  client.setAuth(accessToken);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      client.action(api.workosBootstrap.ensureUserNow, {}),
      new Promise<null>((resolve) => {
        timeout = setTimeout(() => resolve(null), BOOTSTRAP_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
