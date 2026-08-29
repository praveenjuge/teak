import { api } from "@teak/convex";
import { NextResponse } from "next/server";
import { fetchAuthMutation, isAuthenticated } from "@/lib/auth-server";
import type { NativeAuthRequest } from "@/lib/native-auth-request";
import {
  isSameOriginPost,
  nativeAuthCompletionUrl,
  parseNativeAuthRequest,
} from "@/lib/native-auth-request";
import { buildPublicAppUrl } from "@/lib/public-app-url";

const invalidRequest = () =>
  NextResponse.json(
    {
      code: "INVALID_NATIVE_AUTH_REQUEST",
      error: "Invalid native auth request",
    },
    { status: 400 }
  );

const buildLoginRedirect = (requestUrl: URL): NextResponse => {
  const loginUrl = buildPublicAppUrl("/login", requestUrl);
  loginUrl.searchParams.set(
    "next",
    `${requestUrl.pathname.replace("/approve", "/start")}${requestUrl.search}`
  );
  return NextResponse.redirect(loginUrl);
};

const pairingStartUrl = (requestUrl: URL, parsed: NativeAuthRequest): URL => {
  const startUrl = new URL("/native/auth/start", requestUrl.origin);
  startUrl.search = new URLSearchParams({
    code_challenge: parsed.codeChallenge,
    device_id: parsed.deviceId,
    redirect_uri: parsed.redirectUri.toString(),
    state: parsed.state,
    surface: parsed.surface,
  }).toString();
  return startUrl;
};

export async function POST(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  if (!isSameOriginPost(request, requestUrl)) {
    return NextResponse.json(
      {
        code: "CROSS_SITE_BLOCKED",
        error: "Cross-site request rejected",
      },
      { status: 403 }
    );
  }

  const form = await request.formData();
  const parsed = parseNativeAuthRequest({
    codeChallenge: form.get("code_challenge")?.toString(),
    deviceId: form.get("device_id")?.toString(),
    redirectUri: form.get("redirect_uri")?.toString(),
    state: form.get("state")?.toString(),
    surface: form.get("surface")?.toString(),
  });
  if (!parsed) {
    return invalidRequest();
  }

  const authed = await isAuthenticated();
  if (!authed) {
    return buildLoginRedirect(pairingStartUrl(requestUrl, parsed));
  }

  try {
    await fetchAuthMutation(api.authNative.createNativeAuthCode, {
      codeChallenge: parsed.codeChallenge,
      deviceId: parsed.deviceId,
      state: parsed.state,
      surface: parsed.surface,
    });
    return new Response(null, {
      status: 302,
      headers: {
        Location: nativeAuthCompletionUrl(parsed),
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return buildLoginRedirect(pairingStartUrl(requestUrl, parsed));
  }
}
