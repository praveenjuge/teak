import { handleAuth } from "@workos-inc/authkit-nextjs";
import { type NextRequest, NextResponse } from "next/server";
import {
  assertWorkosCallbackBinding,
  inactiveAuthProvider,
} from "@/lib/auth-mode";
import { readAuthMode } from "@/lib/auth-mode-server";
import { readWorkosWebConfig } from "@/lib/workos-config";

export async function GET(request: NextRequest): Promise<Response> {
  const mode = await readAuthMode();
  if (mode.primary !== "workos") {
    return inactiveAuthProvider();
  }
  const config = readWorkosWebConfig(mode);
  if (request.nextUrl.origin !== config.origin) {
    return new Response("Invalid callback origin.", { status: 400 });
  }
  return handleAuth({
    baseURL: config.origin,
    onSuccess: async ({ state }) => {
      const current = await readAuthMode();
      assertWorkosCallbackBinding(state, current, config.clientId);
    },
    // The SDK adds cache and PKCE-expiry headers to this response, so it must
    // be mutable. `Response.redirect` headers are immutable in Node.
    onError: () =>
      NextResponse.redirect(`${config.origin}/sign-in?reauth=1`, 303),
  })(request);
}
