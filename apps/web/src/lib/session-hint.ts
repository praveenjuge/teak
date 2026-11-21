import {
  SESSION_HINT_COOKIE,
  SESSION_HINT_MAX_AGE_SECONDS,
  sessionHintDomain,
} from "@teak/convex/shared/sessionHint";
import type { CookieInit } from "./cookie";

// Readable from script on purpose: teakvault.com reads it to show "Open Teak".
// It is a hint, not a credential (packages/convex/shared/sessionHint.ts).
export function sessionHintCookie(
  origin: string,
  signedIn: boolean
): CookieInit {
  const { hostname, protocol } = new URL(origin);
  const domain = sessionHintDomain(hostname);
  return {
    name: SESSION_HINT_COOKIE,
    value: signedIn ? "1" : "",
    path: "/",
    sameSite: "lax",
    secure: protocol === "https:",
    maxAge: signedIn ? SESSION_HINT_MAX_AGE_SECONDS : 0,
    ...(domain ? { domain } : {}),
  };
}
