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

/**
 * Returns the hostname for a safe `http:`/`https:` URL, otherwise `undefined`.
 *
 * Use when only the domain should be exposed to a third party (for example a
 * favicon service) so the full path/query of a private saved URL — which can
 * contain document IDs or tokens — never leaves the app.
 */
export function getSafeUrlHostname(value: unknown): string | undefined {
  const safe = sanitizeExternalUrl(value);
  if (!safe) {
    return;
  }
  try {
    return new URL(safe).hostname;
  } catch {}
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
