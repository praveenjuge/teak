import { type NextRequest, NextResponse } from "next/server";
import { startWorkosAuth } from "@/app/(auth)/actions";
import { inactiveAuthProvider } from "@/lib/auth-mode";
import { readAuthMode } from "@/lib/auth-mode-server";
import { readWorkosWebConfig } from "@/lib/workos-config";

// WorkOS Initiate login URI. AuthKit sends sign-ins that did not start here
// (password reset and invitation emails, bookmarks) to this route, which must
// start a fresh AuthKit sign-in so the PKCE cookie and state are bound here.
export async function GET(request: NextRequest): Promise<Response> {
  const mode = await readAuthMode();
  if (mode.primary !== "workos") {
    return inactiveAuthProvider();
  }
  const config = readWorkosWebConfig(mode);
  if (request.nextUrl.origin !== config.origin) {
    return new Response("Invalid sign-in origin.", { status: 400 });
  }
  const { url } = await startWorkosAuth(
    request.nextUrl.searchParams.get("next")
  );
  const response = NextResponse.redirect(
    url ?? `${config.origin}/login?error=sign_in_restart`,
    303
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}
