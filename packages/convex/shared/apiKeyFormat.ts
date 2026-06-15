// Canonical Teak public-API key format helpers.
//
// Legacy keys were minted as `teakapi_<prefix>_<secret>`. New keys are minted
// by @vllnt/convex-api-keys as `teakapi_<type>_<env>_<lookup>_<secret>`.
// Centralizing the shape check lets every entry point reject obviously
// malformed tokens before touching the database.

export const API_KEY_TOKEN_PREFIX = "teakapi";

const LEGACY_API_KEY_PART_COUNT = 3;
const COMPONENT_API_KEY_PART_COUNT = 5;
const COMPONENT_LOOKUP_PREFIX_LENGTH = 8;
const COMPONENT_SECRET_LENGTH = 64;

export type ApiKeyFormat = "component" | "legacy" | "malformed";

/**
 * Returns the key format when `token` matches a supported Teak key shape.
 * This is a cheap, allocation-light structural check only; it does not confirm
 * the key exists or is active.
 */
export const getApiKeyFormat = (token: string): ApiKeyFormat => {
  const trimmed = token.trim();
  if (!trimmed.startsWith(`${API_KEY_TOKEN_PREFIX}_`)) {
    return "malformed";
  }

  const parts = trimmed.split("_");
  if (parts.length === LEGACY_API_KEY_PART_COUNT) {
    return parts[1] && parts[2] ? "legacy" : "malformed";
  }

  if (parts.length !== COMPONENT_API_KEY_PART_COUNT) {
    return "malformed";
  }

  const [, type, env, lookupPrefix, secret] = parts;
  if (type !== "secret" && type !== "pub") {
    return "malformed";
  }

  if (!(env && lookupPrefix && secret)) {
    return "malformed";
  }

  if (
    lookupPrefix.length !== COMPONENT_LOOKUP_PREFIX_LENGTH ||
    secret.length !== COMPONENT_SECRET_LENGTH
  ) {
    return "malformed";
  }

  return "component";
};

export const isLegacyApiKey = (token: string): boolean =>
  getApiKeyFormat(token) === "legacy";

export const isComponentApiKey = (token: string): boolean =>
  getApiKeyFormat(token) === "component";

export const isWellFormedApiKey = (token: string): boolean =>
  getApiKeyFormat(token) !== "malformed";
