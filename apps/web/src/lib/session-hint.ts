import {
  SESSION_HINT_COOKIE,
  SESSION_HINT_MAX_AGE_SECONDS,
  sessionHintDomain,
} from "@teak/convex/shared/sessionHint";

interface CookieReader {
  get: (name: string) => { value: string } | undefined;
}

// Readable from script on purpose: teakvault.com reads it to show "Open Teak".
// It is a hint, not a credential (packages/convex/shared/sessionHint.ts).
export function sessionHintCookie(origin: string, signedIn: boolean) {
  const { hostname, protocol } = new URL(origin);
  const domain = sessionHintDomain(hostname);
  return {
    name: SESSION_HINT_COOKIE,
    value: signedIn ? "1" : "",
    path: "/",
    sameSite: "lax" as const,
    secure: protocol === "https:",
    maxAge: signedIn ? SESSION_HINT_MAX_AGE_SECONDS : 0,
    ...(domain ? { domain } : {}),
  };
}

function serializeSessionHint(cookie: ReturnType<typeof sessionHintCookie>) {
  return [
    `${cookie.name}=${cookie.value}`,
    `Path=${cookie.path}`,
    `Max-Age=${cookie.maxAge}`,
    ...(cookie.domain ? [`Domain=${cookie.domain}`] : []),
    "SameSite=Lax",
    ...(cookie.secure ? ["Secure"] : []),
  ].join("; ");
}

/**
 * Writes the hint only when it disagrees with the session. It appends to the
 * headers because AuthKit has already written its own cookies there.
 */
export function syncSessionHint(
  requestCookies: CookieReader,
  responseHeaders: Headers,
  origin: string,
  signedIn: boolean
) {
  const hinted = requestCookies.get(SESSION_HINT_COOKIE)?.value === "1";
  if (hinted !== signedIn) {
    responseHeaders.append(
      "Set-Cookie",
      serializeSessionHint(sessionHintCookie(origin, signedIn))
    );
  }
}
