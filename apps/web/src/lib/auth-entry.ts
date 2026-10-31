import { getSafeNextPath, SIGN_IN_ROUTES } from "./safe-next-path";

// Ask for AuthKit even with a session: `reauth` after a failed callback (it
// also asks for credentials again), `renew` when the app rejected a session
// the server still holds, so AuthKit can issue a fresh one.
const AUTHKIT_REQUIRED = ["reauth", "renew"];

export function workosEntryRedirect(
  url: Pick<URL, "origin" | "pathname" | "searchParams">,
  signedIn: boolean
): URL | null {
  // A signed-in visit to sign-in would only bounce through AuthKit and back.
  if (
    !(signedIn && SIGN_IN_ROUTES.has(url.pathname)) ||
    AUTHKIT_REQUIRED.some((param) => url.searchParams.has(param))
  ) {
    return null;
  }
  const next = getSafeNextPath(url.searchParams.get("next"));
  return new URL(next ?? "/", url.origin);
}
