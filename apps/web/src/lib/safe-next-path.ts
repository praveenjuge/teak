// Routes that should never be used as a post-login redirect target. Sending a
// freshly authenticated user back to an auth page creates confusing loops.
const AUTH_ROUTES = new Set([
  "/login",
  "/register",
  "/reset-password",
  "/forgot-password",
]);

// Control characters (including tab/newline) and backslashes can be normalized
// by URL parsing/navigation into a different host, so reject them outright.
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional control-char rejection
const UNSAFE_CHARS = /[\u0000-\u001F\u007F\\]/;

// Fixed sentinel origin used only to resolve relative paths. If a candidate
// `next` value resolves to any other origin, it is trying to escape the app.
const SENTINEL_ORIGIN = "https://teak.internal";

/**
 * Validate a user-controlled `next` redirect value and return a safe,
 * same-origin relative path, or `null` when it cannot be trusted.
 *
 * The returned value is always a normalized `pathname + search + hash` string
 * that stays on the current origin, so it is safe to feed into navigation,
 * `new URL(value, origin)`, or social `callbackURL` options.
 */
export function getSafeNextPath(
  rawNext: string | null | undefined
): string | null {
  if (!rawNext) {
    return null;
  }

  // Must be an absolute path reference, never a protocol-relative (`//host`)
  // or absolute (`https://host`) URL.
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

  // Resolving the path must not have changed the origin (no host swap via
  // encoded backslashes, dot segments, or similar tricks).
  if (parsed.origin !== SENTINEL_ORIGIN) {
    return null;
  }

  if (AUTH_ROUTES.has(parsed.pathname)) {
    return null;
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
