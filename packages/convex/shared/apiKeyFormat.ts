// Keys are minted by @vllnt/convex-api-keys as
// `teakapi_<type>_<env>_<lookup>_<secret>`.

export const API_KEY_TOKEN_PREFIX = "teakapi";

const COMPONENT_API_KEY_PART_COUNT = 5;
const COMPONENT_LOOKUP_PREFIX_LENGTH = 8;
const COMPONENT_SECRET_LENGTH = 64;

export type ApiKeyFormat = "component" | "malformed";

export const getApiKeyFormat = (token: string): ApiKeyFormat => {
  const trimmed = token.trim();
  if (!trimmed.startsWith(`${API_KEY_TOKEN_PREFIX}_`)) {
    return "malformed";
  }

  const parts = trimmed.split("_");
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

export const isWellFormedApiKey = (token: string): boolean =>
  getApiKeyFormat(token) !== "malformed";
