import { auth } from "@clerk/nextjs/server";
import { resolveTeakDevAppUrl } from "@teak/config/dev-urls";
import { api } from "@teak/convex";
import { ConvexHttpClient } from "convex/browser";
import { NextResponse } from "next/server";
import { buildPublicAppUrl } from "@/lib/public-app-url";

export const dynamic = "force-dynamic";

const DEVICE_ID_PATTERN = /^[A-Za-z0-9-]{16,128}$/;
const PKCE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const STATE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const ALLOWED_COMPLETION_REDIRECTS = new Set([
  `${resolveTeakDevAppUrl(process.env)}/desktop/auth/complete`,
  "https://app.teakvault.com/desktop/auth/complete",
]);

function buildLoginRedirect(requestUrl: URL): NextResponse {
  const loginUrl = buildPublicAppUrl("/login", requestUrl);
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

function parseJwtExpiry(token: string): number {
  const [, payload] = token.split(".");
  if (!payload) {
    return Date.now() + 5 * 60 * 1000;
  }

  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const parsed = JSON.parse(
      Buffer.from(padded, "base64").toString("utf8")
    ) as {
      exp?: unknown;
    };
    if (typeof parsed.exp === "number") {
      return parsed.exp * 1000;
    }
  } catch {
    return Date.now() + 5 * 60 * 1000;
  }

  return Date.now() + 5 * 60 * 1000;
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

  const authState = await auth();
  if (!authState.userId) {
    return buildLoginRedirect(requestUrl);
  }

  try {
    const convexToken = await authState.getToken({ template: "convex" });
    if (!convexToken) {
      return buildLoginRedirect(requestUrl);
    }

    const expiry = parseJwtExpiry(convexToken);
    const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    client.setAuth(convexToken);
    await client.mutation(api.authDesktop.createDesktopAuthCode, {
      deviceId,
      codeChallenge,
      state,
      convexToken,
      tokenExpiresAt: expiry,
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
