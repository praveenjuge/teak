import type { CookieInit } from "./cookie";

/**
 * How the last sign-in authenticated (WorkOS's `authenticationMethod`, such
 * as `GoogleOAuth`), from the AuthKit callback to the app's first
 * `ensureUser`, which reports it on a new account's `user_signed_up`. It
 * names a sign-in method, not a credential, so script reads it.
 */
const AUTH_METHOD_COOKIE = "teak_auth_method";
const AUTH_METHOD_MAX_AGE_SECONDS = 10 * 60;
const AUTH_METHOD = /^[A-Za-z]{1,32}$/u;

export function authMethodCookie(method: string, secure: boolean): CookieInit {
  return {
    name: AUTH_METHOD_COOKIE,
    value: AUTH_METHOD.test(method) ? method : "",
    path: "/",
    sameSite: "lax",
    secure,
    maxAge: AUTH_METHOD_MAX_AGE_SECONDS,
  };
}

export function readAuthMethod(cookieHeader: string): string | undefined {
  for (const entry of cookieHeader.split(";")) {
    const [name, value] = entry.trim().split("=");
    if (name === AUTH_METHOD_COOKIE && value && AUTH_METHOD.test(value)) {
      return value;
    }
  }
}
