const SAFE_URL_PROTOCOLS = new Set(["http:", "https:"]);

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

export function sanitizeExternalUrl(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return;
  }
  const trimmed = value.trim();
  return isSafeExternalUrl(trimmed) ? trimmed : undefined;
}

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
