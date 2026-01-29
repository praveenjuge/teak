/**
 * Gets the Better Auth session token from the web app's cookies.
 * This allows the extension to share the session with the web app.
 */
export async function getSessionTokenFromCookies(): Promise<string | null> {
  const url = import.meta.env.DEV
    ? "http://localhost:3000"
    : "https://app.teakvault.com";

  // Cookie names differ between dev and prod:
  // - Dev (HTTP): "better-auth.session_token"
  // - Prod (HTTPS): "__Secure-better-auth.session_token"
  const cookieName = import.meta.env.DEV
    ? "better-auth.session_token"
    : "__Secure-better-auth.session_token";

  try {
    const cookie = await chrome.cookies.get({
      url,
      name: cookieName,
    });

    return cookie?.value ?? null;
  } catch (error) {
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
