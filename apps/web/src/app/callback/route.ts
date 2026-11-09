import { handleAuth } from "@workos-inc/authkit-nextjs";
import { cookies } from "next/headers";
import { connection, type NextRequest, NextResponse } from "next/server";
import { signInUrl } from "@/lib/authUrls";
import { sessionHintCookie } from "@/lib/session-hint";
import { readWorkosWebConfig } from "@/lib/workos-config";

export async function GET(request: NextRequest): Promise<Response> {
  await connection();
  const { origin } = request.nextUrl;
  const config = readWorkosWebConfig();
  if (origin !== config.origin) {
    return new Response("Invalid callback origin.", { status: 400 });
  }
  return await handleAuth({
    baseURL: config.origin,
    onSuccess: async () => {
      (await cookies()).set(sessionHintCookie(config.origin, true));
    },
    // The SDK adds cache and PKCE-expiry headers to this response, so it must
    // be mutable. `Response.redirect` headers are immutable in Node.
    onError: () =>
      NextResponse.redirect(signInUrl(config.origin, { reauth: true }), 303),
  })(request);
}
