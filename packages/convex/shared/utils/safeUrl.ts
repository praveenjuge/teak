/**
 * Shared safe-external-URL policy for card URLs.
 *
 * Card URLs are user-controlled and end up in browser navigation sinks
 * (`window.open`, `<a href>`, `Linking.openURL`, Electron `shell.openExternal`).
 * A stored `javascript:`, `data:`, `vbscript:`, or `file:` URL can execute
 * script or trigger dangerous local navigation when a user opens a card.
 *
 * This module enforces a single rule: a card URL is only "safe" when it parses
 * as an absolute URL with an `http:` or `https:` scheme. It is intentionally
 * free of Node.js/DOM built-ins (only the standard `URL` constructor, available
 * in the Convex runtime, browsers, and React Native/Hermes) so it can be shared
 * by the backend write boundaries and every client render/open sink.
 *
 * This is distinct from the server-side SSRF guard in `linkMetadata/ssrf.ts`,
 * which additionally resolves DNS and blocks private/reserved IP ranges for
 * outbound server fetches. This helper is only a scheme allowlist for URLs a
 * user chooses to open.
 */

const SAFE_URL_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Returns true when `value` is an absolute `http:`/`https:` URL that is safe to
 * place in a navigation sink. Returns false for non-strings, empty strings,
 * unparseable URLs, scheme-relative/relative URLs, and any other scheme
 * (`javascript:`, `data:`, `file:`, `mailto:`, etc.).
 */
export function isSafeExternalUrl(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  return SAFE_URL_PROTOCOLS.has(parsed.protocol);
}

/**
 * Returns the trimmed URL when it is a safe external URL, otherwise `undefined`.
 * Use at render/open sinks to decide whether to expose a clickable link.
 */
export function sanitizeExternalUrl(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return;
  }
  const trimmed = value.trim();
  return isSafeExternalUrl(trimmed) ? trimmed : undefined;
}

export class UnsafeUrlError extends Error {
  constructor(message = "URL must use the http or https scheme") {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

/**
 * Validates a card URL at a write boundary. Returns the trimmed URL when safe,
 * `undefined` when `value` is nullish/empty, and throws {@link UnsafeUrlError}
 * when a non-empty value is not a safe `http:`/`https:` URL.
 */
export function assertSafeExternalUrl(
  value: string | null | undefined
): string | undefined {
  if (value === null || value === undefined) {
    return;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return;
  }
  if (!isSafeExternalUrl(trimmed)) {
    throw new UnsafeUrlError();
  }
  return trimmed;
}
