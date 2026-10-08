import { handleAuth } from "@workos-inc/authkit-nextjs";
import { type NextRequest, NextResponse } from "next/server";
import {
  assertWorkosCallbackBinding,
  readWorkosWebConfig,
} from "@/lib/workos-config";

export async function GET(request: NextRequest): Promise<Response> {
  // Reading the request first keeps this handler per-request: Next would
  // otherwise prerender it at build time, before runtime config exists.
  const { origin } = request.nextUrl;
  const config = readWorkosWebConfig();
  if (origin !== config.origin) {
    return new Response("Invalid callback origin.", { status: 400 });
  }
  return await handleAuth({
    baseURL: config.origin,
    onSuccess: ({ state }) => {
      assertWorkosCallbackBinding(state, config.clientId);
    },
    // The SDK adds cache and PKCE-expiry headers to this response, so it must
    // be mutable. `Response.redirect` headers are immutable in Node.
    onError: () =>
      NextResponse.redirect(`${config.origin}/sign-in?reauth=1`, 303),
  })(request);
}
