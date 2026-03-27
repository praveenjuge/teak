import { resolveTeakDevAppUrl } from "@teak/config/dev-urls";

/**
 * Gets the Clerk session token from the web app's cookies.
 */
export async function getSessionTokenFromCookies(): Promise<string | null> {
  const url = import.meta.env.DEV
    ? resolveTeakDevAppUrl(import.meta.env)
    : "https://app.teakvault.com";

  try {
    const cookie = await chrome.cookies.get({
      url,
      name: "__session",
    });

    return cookie?.value ?? null;
  } catch (_error) {
    return null;
  }
}

/**
 * Check if the user has a valid session by checking the web app's session cookie.
 */
export async function hasValidSession(): Promise<boolean> {
  const token = await getSessionTokenFromCookies();
  return token !== null;
}
