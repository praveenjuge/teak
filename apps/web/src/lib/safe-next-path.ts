// Teak's sign-in pages, and the older addresses that still lead to them.
export const SIGN_IN_ROUTES = new Set(["/sign-in", "/sign-up"]);
export const SIGN_IN_ALIASES: Record<string, string> = {
  "/login": "/sign-in",
  "/register": "/sign-up",
};

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

  // Dot segments normalize away after the raw check above: `/.//evil.com`
  // parses to the pathname `//evil.com`, which a redirect reads as a host.
  if (parsed.origin !== SENTINEL_ORIGIN || parsed.pathname.startsWith("//")) {
    return null;
  }

  // With the default `trailingSlash: false`, Next redirects `/sign-in/` (and
  // `/sign-in//`) to `/sign-in`, so compare without trailing slashes.
  const route = parsed.pathname.replace(/\/+$/, "");
  if (SIGN_IN_ROUTES.has(route) || Object.hasOwn(SIGN_IN_ALIASES, route)) {
    return null;
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
