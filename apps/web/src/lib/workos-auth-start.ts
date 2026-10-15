import "server-only";
import { api } from "@teak/convex";
import { getSignInUrl, getSignUpUrl } from "@workos-inc/authkit-nextjs";
import { ConvexHttpClient } from "convex/browser";
import { connection, type NextRequest, NextResponse } from "next/server";
import { getConvexUrl } from "./public-env";
import { getSafeNextPath } from "./safe-next-path";
import { readWorkosWebConfig, workosCallbackState } from "./workos-config";

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
  await connection();
  const { origin } = request.nextUrl;
  const config = readWorkosWebConfig();
  if (origin !== config.origin) {
    return new Response("Invalid sign-in origin.", { status: 400 });
  }
  // A Next.js router fetch (`RSC: 1`) lands here by following the proxy's
  // sign-in redirect: a prefetch or navigation without a session, as right
  // after sign-out. It can't follow a redirect to hosted AuthKit, because
  // connect-src blocks the cross-origin hop. An empty response makes Next.js
  // drop a prefetch and load a navigation as a full page, which redirects.
  if (request.headers.get("rsc") === "1") {
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
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
