// Canonical Teak public-API key format helpers.
//
// Keys are minted as `teakapi_<prefix>_<secret>` (see apiKeys.ts). Centralizing
// the shape check lets every entry point (rate limiting, validation) reject
// obviously malformed tokens the same way, so the public API never spends a
// database write on garbage that can never resolve to a real key.

export const API_KEY_TOKEN_PREFIX = "teakapi";

const API_KEY_PART_COUNT = 3;

/**
 * Returns true when `token` matches the `teakapi_<prefix>_<secret>` shape.
 * This is a cheap, allocation-light structural check only; it does not confirm
 * the key exists or is active.
 */
export const isWellFormedApiKey = (token: string): boolean => {
  const trimmed = token.trim();
  if (!trimmed.startsWith(`${API_KEY_TOKEN_PREFIX}_`)) {
    return false;
  }

  const parts = trimmed.split("_");
  if (parts.length !== API_KEY_PART_COUNT) {
    return false;
  }

  // prefix and secret segments must both be non-empty.
  return Boolean(parts[1]) && Boolean(parts[2]);
};
