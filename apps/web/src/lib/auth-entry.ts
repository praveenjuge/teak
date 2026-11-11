import {
  NEXT_PARAM,
  REAUTH_PARAM,
  RENEW_PARAM,
  SIGN_IN_ROUTES,
} from "./authUrls";
import { getSafeNextPath } from "./safe-next-path";

export function workosEntryRedirect(
  url: Pick<URL, "origin" | "pathname" | "searchParams">,
  signedIn: boolean
): URL | null {
  // A signed-in visit to sign-in would only bounce through AuthKit and back.
  if (
    !(signedIn && SIGN_IN_ROUTES.has(url.pathname)) ||
    url.searchParams.has(REAUTH_PARAM) ||
    url.searchParams.has(RENEW_PARAM)
  ) {
    return null;
  }
  const next = getSafeNextPath(url.searchParams.get(NEXT_PARAM));
  return new URL(next ?? "/", url.origin);
}
