import type { NextRequest } from "next/server";
import { startWorkosAuth } from "@/lib/workos-auth-start";

// WorkOS Initiate login URI. AuthKit sends sign-ins that did not start here
// (password reset and invitation emails, bookmarks) to this route, which must
// start a fresh AuthKit sign-in so the PKCE cookie and state are bound here.
export function GET(request: NextRequest): Promise<Response> {
  return startWorkosAuth(request, "sign-in");
}
