const AUTH_ROUTES = new Set([
  "/login",
  "/register",
  "/reset-password",
  "/forgot-password",
  "/sign-in",
  "/sign-up",
]);

// Control characters (including tab/newline) and backslashes can be normalized
// by URL parsing/navigation into a different host, so reject them outright.
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional control-char rejection
const UNSAFE_CHARS = /[\u0000-\u001F\u007F\\]/;

const SENTINEL_ORIGIN = "https://teak.internal";

export function getSafeNextPath(
  rawNext: string | null | undefined
): string | null {
  if (!rawNext) {
    return null;
  }

  if (!rawNext.startsWith("/") || rawNext.startsWith("//")) {
    return null;
  }

  if (UNSAFE_CHARS.test(rawNext)) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(rawNext, SENTINEL_ORIGIN);
  } catch {
    return null;
  }

  if (parsed.origin !== SENTINEL_ORIGIN) {
    return null;
  }

  // With the default `trailingSlash: false`, Next redirects `/sign-in/` (and
  // `/sign-in//`) to `/sign-in`, so compare without trailing slashes.
  if (AUTH_ROUTES.has(parsed.pathname.replace(/\/+$/, ""))) {
    return null;
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
