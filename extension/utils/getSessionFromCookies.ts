/**
 * Gets the Better Auth session token from the web app's cookies.
 * This allows the extension to share the session with the web app.
 */
export async function getSessionTokenFromCookies(): Promise<string | null> {
  const url = import.meta.env.DEV
    ? "http://localhost:3000"
    : "https://app.teakvault.com";

  try {
    // Better Auth uses 'better-auth.session_token' as the cookie name
    const cookie = await chrome.cookies.get({
      url,
      name: "better-auth.session_token",
    });

    return cookie?.value ?? null;
  } catch (error) {
    console.error("Failed to get session cookie:", error);
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
