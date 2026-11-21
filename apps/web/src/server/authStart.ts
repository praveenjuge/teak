import { api } from "@teak/convex";
import {
  getAuth,
  getSignInUrl,
  getSignUpUrl,
} from "@workos/authkit-tanstack-react-start";
import { ConvexHttpClient } from "convex/browser";
import { workosEntryRedirect } from "@/lib/auth-entry";
import { NEXT_PARAM, REAUTH_PARAM } from "@/lib/authUrls";
import { getConvexUrl } from "@/lib/public-env";
import { getSafeNextPath } from "@/lib/safe-next-path";
import { configureWorkos } from "./workos";

const SIGNUPS_FRESH_MS = 60_000;
let signupsCache: { open: boolean; until: number } | undefined;

// The admin pause switch changes rarely, so every sign-up click shouldn't wait
// on a Convex round trip to read it. A failed read isn't cached, and counts
// as closed.
async function signupsOpen(now = Date.now()): Promise<boolean> {
  if (signupsCache && signupsCache.until > now) {
    return signupsCache.open;
  }
  try {
    const mode = await new ConvexHttpClient(getConvexUrl()).query(
      api.auth.getAuthMode,
      {}
    );
    signupsCache = {
      open: !mode.signupsDisabled,
      until: now + SIGNUPS_FRESH_MS,
    };
    return signupsCache.open;
  } catch {
    return false;
  }
}

const noStore = { "Cache-Control": "no-store" };

/**
 * Starts hosted AuthKit for /sign-in and /sign-up. AuthKit binds its PKCE
 * cookie and state to this browser here, so sign-ins that didn't start in the
 * app (password reset and invitation emails, bookmarks) come through it too.
 */
export async function startWorkosAuth(
  request: Request,
  screen: "sign-in" | "sign-up"
): Promise<Response> {
  const config = configureWorkos();
  const url = new URL(request.url);
  const { user } = await getAuth();
  const entry = workosEntryRedirect(url, Boolean(user));
  if (entry) {
    return new Response(null, {
      status: 303,
      headers: { ...noStore, Location: entry.toString() },
    });
  }
  const options = {
    returnPathname: getSafeNextPath(url.searchParams.get(NEXT_PARAM)) ?? "/",
    redirectUri: config.redirectUri,
    // After a failed callback, ask for credentials again so an existing
    // AuthKit session can't send the browser straight back into the failure.
    ...(url.searchParams.has(REAUTH_PARAM) && { maxAge: 0 }),
  };
  const location =
    screen === "sign-up" && (await signupsOpen())
      ? await getSignUpUrl({ data: options })
      : await getSignInUrl({ data: options });
  return new Response(null, {
    status: 303,
    headers: { ...noStore, Location: location },
  });
}
