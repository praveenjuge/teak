import { api } from "@teak/convex";
import { NextResponse } from "next/server";
import { fetchAuthMutation, isAuthenticated } from "@/lib/auth-server";

export const dynamic = "force-dynamic";

const DEVICE_ID_PATTERN = /^[A-Za-z0-9-]{16,128}$/;
const PKCE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const STATE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const ALLOWED_COMPLETION_REDIRECTS = new Set([
  "http://localhost:3000/desktop/auth/complete",
  "https://app.teakvault.com/desktop/auth/complete",
]);

function buildLoginRedirect(requestUrl: URL): NextResponse {
  const loginUrl = new URL("/login", requestUrl);
  loginUrl.searchParams.set(
    "next",
    `${requestUrl.pathname}${requestUrl.search}`
  );
  return NextResponse.redirect(loginUrl);
}

function parseDesktopRedirectUri(raw: string | null): URL | null {
  if (!raw) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  if (parsed.search) {
    return null;
  }

  if (parsed.hash) {
    return null;
  }

  const normalizedTarget = `${parsed.origin}${parsed.pathname}`;
  if (!ALLOWED_COMPLETION_REDIRECTS.has(normalizedTarget)) {
    return null;
  }
  return parsed;
}

export async function GET(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const deviceId = requestUrl.searchParams.get("device_id")?.trim() ?? "";
  const codeChallenge =
    requestUrl.searchParams.get("code_challenge")?.trim() ?? "";
  const state = requestUrl.searchParams.get("state")?.trim() ?? "";
  const redirectUri = parseDesktopRedirectUri(
    requestUrl.searchParams.get("redirect_uri")
  );

  if (
    !(
      DEVICE_ID_PATTERN.test(deviceId) &&
      PKCE_CHALLENGE_PATTERN.test(codeChallenge) &&
      STATE_PATTERN.test(state) &&
      redirectUri
    )
  ) {
    return NextResponse.json(
      {
        code: "INVALID_DESKTOP_AUTH_REQUEST",
        error: "Invalid desktop auth request",
      },
      { status: 400 }
    );
  }

  const authed = await isAuthenticated();
  if (!authed) {
    return buildLoginRedirect(requestUrl);
  }

  try {
    await fetchAuthMutation(api.authDesktop.createDesktopAuthCode, {
      deviceId,
      codeChallenge,
      state,
    });
    redirectUri.searchParams.set("state", state);
    return new Response(null, {
      status: 302,
      headers: {
        Location: redirectUri.toString(),
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return buildLoginRedirect(requestUrl);
  }
}
