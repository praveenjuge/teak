import { resolveTeakDevAppUrl } from "@teak/convex/dev-urls";

export const NATIVE_AUTH_SURFACES = [
  "desktop",
  "safari-macos",
  "safari-ios",
  "safari-ipados",
  "browser-extension",
] as const;

export type NativeAuthSurface = (typeof NATIVE_AUTH_SURFACES)[number];

export const NATIVE_AUTH_SURFACE_LABELS: Record<NativeAuthSurface, string> = {
  desktop: "Teak Desktop",
  "safari-macos": "Teak Safari (macOS)",
  "safari-ios": "Teak Safari (iOS)",
  "safari-ipados": "Teak Safari (iPadOS)",
  "browser-extension": "Teak Browser Extension",
};

const DEVICE_ID_PATTERN = /^[A-Za-z0-9-]{16,128}$/;
const PKCE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const STATE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const NATIVE_AUTH_SURFACE_SET = new Set<string>(NATIVE_AUTH_SURFACES);

const allowedCompletionRedirects = (): Set<string> => {
  const allowed = new Set(["https://app.teakvault.com/native/auth/complete"]);
  try {
    allowed.add(`${resolveTeakDevAppUrl(process.env)}/native/auth/complete`);
  } catch {
    return allowed;
  }
  return allowed;
};

export interface NativeAuthRequest {
  codeChallenge: string;
  deviceId: string;
  redirectUri: URL;
  state: string;
  surface: NativeAuthSurface;
}

const firstSearchValue = (
  value: string | string[] | undefined
): string | null => {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }
  return null;
};

export const parseNativeRedirectUri = (raw: string | null): URL | null => {
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
  if (!allowedCompletionRedirects().has(normalizedTarget)) {
    return null;
  }
  return parsed;
};

export const parseNativeAuthRequest = (input: {
  codeChallenge?: string | string[];
  deviceId?: string | string[];
  redirectUri?: string | string[] | null;
  state?: string | string[];
  surface?: string | string[];
}): NativeAuthRequest | null => {
  const deviceId = firstSearchValue(input.deviceId)?.trim() ?? "";
  const codeChallenge = firstSearchValue(input.codeChallenge)?.trim() ?? "";
  const state = firstSearchValue(input.state)?.trim() ?? "";
  const surface = firstSearchValue(input.surface)?.trim() ?? "";
  const redirectUri = parseNativeRedirectUri(
    firstSearchValue(input.redirectUri ?? undefined)
  );

  if (
    !(
      DEVICE_ID_PATTERN.test(deviceId) &&
      PKCE_CHALLENGE_PATTERN.test(codeChallenge) &&
      STATE_PATTERN.test(state) &&
      NATIVE_AUTH_SURFACE_SET.has(surface) &&
      redirectUri
    )
  ) {
    return null;
  }

  return {
    codeChallenge,
    deviceId,
    redirectUri,
    state,
    surface: surface as NativeAuthSurface,
  };
};

export const isSameOriginPost = (
  request: Request,
  requestUrl: URL
): boolean => {
  const originHeader = request.headers.get("origin");
  if (!originHeader) {
    return false;
  }

  let origin: string;
  try {
    origin = new URL(originHeader).origin;
  } catch {
    return false;
  }

  if (origin !== requestUrl.origin) {
    return false;
  }

  const secFetchSite = request.headers.get("sec-fetch-site");
  if (
    secFetchSite &&
    secFetchSite !== "same-origin" &&
    secFetchSite !== "same-site"
  ) {
    return false;
  }

  return true;
};

export const nativeAuthCompletionUrl = (request: NativeAuthRequest): string => {
  const redirectUri = new URL(request.redirectUri.toString());
  redirectUri.searchParams.set("state", request.state);
  redirectUri.searchParams.set("surface", request.surface);
  return redirectUri.toString();
};
