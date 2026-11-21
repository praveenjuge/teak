import { SESSION_HINT_COOKIE } from "@teak/convex/shared/sessionHint";
import { serializeCookie } from "@/lib/cookie";
import { sessionHintCookie } from "@/lib/session-hint";
import { configureWorkos } from "./workos";

const readCookie = (request: Request, name: string): string | undefined => {
  for (const entry of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = entry.trim().split("=");
    if (key === name) {
      return value.join("=");
    }
  }
  return undefined;
};

/**
 * The `Set-Cookie` header that brings the readable session hint in line with
 * the session, or null when they already agree. teakvault.com reads the hint
 * to show "Open Teak".
 */
export function sessionHintHeader(
  request: Request,
  origin: string,
  signedIn: boolean
): string | null {
  const hinted = readCookie(request, SESSION_HINT_COOKIE) === "1";
  return hinted === signedIn
    ? null
    : serializeCookie(sessionHintCookie(origin, signedIn));
}

export const signInUnavailable = () =>
  new Response(
    "Sign-in is temporarily unavailable. Please reload to try again.",
    { status: 503, headers: { "Cache-Control": "no-store" } }
  );

// Routes that answer the same with or without a session, and that the share
// sheet or the browser may request from outside a page.
const PUBLIC_PATHS = new Set(["/share", "/sw.js", "/manifest.webmanifest"]);

/**
 * Checks sign-in is configured and that the request came to the app's own
 * origin, where its cookies and the WorkOS callback live. Returns the
 * response that refuses it, or null to go on.
 */
export function signInGuard(request: Request): Response | null {
  let origin: string;
  try {
    ({ origin } = configureWorkos());
  } catch {
    return signInUnavailable();
  }
  const url = new URL(request.url);
  if (!PUBLIC_PATHS.has(url.pathname) && url.origin !== origin) {
    return new Response("Invalid sign-in origin.", { status: 400 });
  }
  return null;
}
