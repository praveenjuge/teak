import { api } from "@teak/convex";
import { resolveTeakDevAppUrl } from "@teak/convex/dev-urls";
import { NextResponse } from "next/server";
import { fetchAuthMutation, isAuthenticated } from "@/lib/auth-server";
import { buildPublicAppUrl } from "@/lib/public-app-url";

export const dynamic = "force-dynamic";

const DEVICE_ID_PATTERN = /^[A-Za-z0-9-]{16,128}$/;
const PKCE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const STATE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const NATIVE_AUTH_SURFACES = new Set([
  "desktop",
  "safari-macos",
  "safari-ios",
  "safari-ipados",
]);
const ALLOWED_COMPLETION_REDIRECTS = new Set([
  `${resolveTeakDevAppUrl(process.env)}/native/auth/complete`,
  "https://app.teakvault.com/native/auth/complete",
]);

function buildLoginRedirect(requestUrl: URL): NextResponse {
  const loginUrl = buildPublicAppUrl("/login", requestUrl);
  loginUrl.searchParams.set(
    "next",
    `${requestUrl.pathname}${requestUrl.search}`
  );
  return NextResponse.redirect(loginUrl);
}

function parseNativeRedirectUri(raw: string | null): URL | null {
  if (!raw) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  if (parsed.search || parsed.hash) {
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
  const surface = requestUrl.searchParams.get("surface")?.trim() ?? "";
  const redirectUri = parseNativeRedirectUri(
    requestUrl.searchParams.get("redirect_uri")
  );

  if (
    !(
      DEVICE_ID_PATTERN.test(deviceId) &&
      PKCE_CHALLENGE_PATTERN.test(codeChallenge) &&
      STATE_PATTERN.test(state) &&
      NATIVE_AUTH_SURFACES.has(surface) &&
      redirectUri
    )
  ) {
    return NextResponse.json(
      {
        code: "INVALID_NATIVE_AUTH_REQUEST",
        error: "Invalid native auth request",
      },
      { status: 400 }
    );
  }

  const authed = await isAuthenticated();
  if (!authed) {
    return buildLoginRedirect(requestUrl);
  }

  try {
    await fetchAuthMutation((api as any).authNative.createNativeAuthCode, {
      deviceId,
      codeChallenge,
      state,
      surface,
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
