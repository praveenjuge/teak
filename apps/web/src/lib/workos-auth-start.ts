import "server-only";
import { api } from "@teak/convex";
import { getSignInUrl, getSignUpUrl } from "@workos-inc/authkit-nextjs";
import { ConvexHttpClient } from "convex/browser";
import { type NextRequest, NextResponse } from "next/server";
import { getConvexUrl } from "./public-env";
import { getSafeNextPath } from "./safe-next-path";
import { readWorkosWebConfig, workosCallbackState } from "./workos-config";

// While sign-ups are paused, sign-up opens the sign-in screen instead of a
// form the backend would reject. If the flag can't be read, sign-in is safe.
const signupsOpen = async (): Promise<boolean> => {
  try {
    const mode = await new ConvexHttpClient(getConvexUrl()).query(
      api.auth.getAuthMode,
      {}
    );
    return !mode.signupsDisabled;
  } catch {
    return false;
  }
};

// Starts hosted AuthKit from a route handler: the SDK writes the PKCE cookie
// through `cookies()`, which only route handlers and server actions may set.
export async function startWorkosAuth(
  request: NextRequest,
  screen: "sign-in" | "sign-up"
): Promise<Response> {
  // Reading the request first keeps these handlers per-request: Next would
  // otherwise prerender them at build time, before runtime config exists.
  const { origin } = request.nextUrl;
  const config = readWorkosWebConfig();
  if (origin !== config.origin) {
    return new Response("Invalid sign-in origin.", { status: 400 });
  }
  const params = request.nextUrl.searchParams;
  const options = {
    returnTo: getSafeNextPath(params.get("next")) ?? "/",
    redirectUri: config.redirectUri,
    state: workosCallbackState(config.clientId),
    // After a failed callback, ask for credentials again so an existing
    // AuthKit session can't send the browser straight back into the failure.
    ...(params.has("reauth") && { maxAge: 0 }),
  };
  const location =
    screen === "sign-up" && (await signupsOpen())
      ? await getSignUpUrl(options)
      : await getSignInUrl(options);
  const response = NextResponse.redirect(location, 303);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
