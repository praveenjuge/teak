import "server-only";
import { getSignInUrl, getSignUpUrl } from "@workos-inc/authkit-nextjs";
import { type NextRequest, NextResponse } from "next/server";
import { inactiveAuthProvider } from "./auth-mode";
import { readAuthMode } from "./auth-mode-server";
import { getSafeNextPath } from "./safe-next-path";
import { readWorkosWebConfig } from "./workos-config";

// Starts hosted AuthKit from a route handler: the SDK writes the PKCE cookie
// through `cookies()`, which only route handlers and server actions may set.
export async function startWorkosAuth(
  request: NextRequest,
  screen: "sign-in" | "sign-up"
): Promise<Response> {
  const mode = await readAuthMode();
  if (mode.primary !== "workos") {
    return inactiveAuthProvider();
  }
  const config = readWorkosWebConfig(mode);
  if (request.nextUrl.origin !== config.origin) {
    return new Response("Invalid sign-in origin.", { status: 400 });
  }
  const params = request.nextUrl.searchParams;
  const options = {
    returnTo: getSafeNextPath(params.get("next")) ?? "/",
    redirectUri: config.redirectUri,
    state: JSON.stringify({ primary: mode.primary, clientId: config.clientId }),
    // After a failed callback, ask for credentials again so an existing
    // AuthKit session can't send the browser straight back into the failure.
    ...(params.has("reauth") && { maxAge: 0 }),
  };
  const location =
    screen === "sign-up" && !mode.signupsDisabled
      ? await getSignUpUrl(options)
      : await getSignInUrl(options);
  const response = NextResponse.redirect(location, 303);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
