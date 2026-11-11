import { SIGN_IN_PATH, SIGN_UP_PATH } from "@teak/convex/shared/webRoutes";

export const SIGN_IN_ROUTES: ReadonlySet<string> = new Set([
  SIGN_IN_PATH,
  SIGN_UP_PATH,
]);

/** Where sign-in returns to: a path on this origin. */
export const NEXT_PARAM = "next";

/**
 * Ask for AuthKit even with a session: `reauth` after a failed callback (it
 * also asks for credentials again), `renew` when the app rejected a session
 * the server still holds, so AuthKit can issue a fresh one.
 */
export const REAUTH_PARAM = "reauth";
export const RENEW_PARAM = "renew";

export interface SignInOptions {
  next?: string;
  reauth?: boolean;
  renew?: boolean;
}

const signInSearch = ({ next, reauth, renew }: SignInOptions) => {
  const params = new URLSearchParams();
  if (reauth) {
    params.set(REAUTH_PARAM, "1");
  }
  if (renew) {
    params.set(RENEW_PARAM, "1");
  }
  if (next !== undefined) {
    params.set(NEXT_PARAM, next);
  }
  const search = params.toString();
  return search ? `?${search}` : "";
};

/** The sign-in route as a path, such as `/sign-in?renew=1&next=%2Fsettings`. */
export const signInPath = (options: SignInOptions = {}): string =>
  `${SIGN_IN_PATH}${signInSearch(options)}`;

/** The sign-in route on `origin`. */
export const signInUrl = (origin: string, options: SignInOptions = {}): URL =>
  new URL(signInPath(options), origin);
