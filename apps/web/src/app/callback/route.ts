import { handleAuth } from "@workos-inc/authkit-nextjs";
import { connection, type NextRequest, NextResponse } from "next/server";
import {
  assertWorkosCallbackBinding,
  readWorkosWebConfig,
} from "@/lib/workos-config";

export async function GET(request: NextRequest): Promise<Response> {
  await connection();
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
