import { api } from "@teak/convex";
import { handleAuth } from "@workos-inc/authkit-nextjs";
import { ConvexHttpClient } from "convex/browser";
import { cookies } from "next/headers";
import { after, connection, type NextRequest, NextResponse } from "next/server";
import { getConvexUrl } from "@/lib/public-env";
import { sessionHintCookie } from "@/lib/session-hint";
import { readWorkosWebConfig } from "@/lib/workos-config";

// Creates a new account's owner (and brings an existing one's name and
// address up to date) while the browser follows the redirect, so the app's
// first query usually finds it. It runs after the response, so no sign-in
// waits on it; the app still runs `ensureUser` itself when it finds no owner.
const ensureOwner = async (accessToken: string) => {
  try {
    await new ConvexHttpClient(getConvexUrl(), {
      auth: accessToken,
      logger: false,
    }).mutation(api.workosBootstrap.ensureUser, {});
  } catch {
    // The app's own `ensureUser` retries and shows what went wrong.
  }
};

export async function GET(request: NextRequest): Promise<Response> {
  await connection();
  const { origin } = request.nextUrl;
  const config = readWorkosWebConfig();
  if (origin !== config.origin) {
    return new Response("Invalid callback origin.", { status: 400 });
  }
  return await handleAuth({
    baseURL: config.origin,
    onSuccess: async ({ accessToken }) => {
      (await cookies()).set(sessionHintCookie(config.origin, true));
      after(() => ensureOwner(accessToken));
    },
    // The SDK adds cache and PKCE-expiry headers to this response, so it must
    // be mutable. `Response.redirect` headers are immutable in Node.
    onError: () =>
      NextResponse.redirect(`${config.origin}/sign-in?reauth=1`, 303),
  })(request);
}
