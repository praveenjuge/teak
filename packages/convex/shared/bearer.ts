import { isWellFormedApiKey } from "./apiKeyFormat";

/** The longest bearer read as a WorkOS Connect access token. */
export const MAX_BEARER_LENGTH = 16_384;

/** The token of an `Authorization: Bearer <token>` header, or null. */
export const parseBearer = (
  authorization: string | null | undefined
): string | null => {
  const [scheme, token] = (authorization ?? "").trim().split(/\s+/u, 2);
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
};

/** Whether a token has a JWT's shape (WorkOS Connect access tokens do). */
export const looksLikeAccessToken = (token: string): boolean =>
  token.length <= MAX_BEARER_LENGTH && token.split(".").length === 3;

export type BearerCredentialKind =
  | "missing"
  | "api_key"
  | "workos_connect"
  | "malformed";

/** Which kind of credential a bearer claims to be, read from its shape. */
export const bearerCredentialKind = (
  token: string | null
): BearerCredentialKind => {
  if (!token) {
    return "missing";
  }
  if (isWellFormedApiKey(token)) {
    return "api_key";
  }
  return looksLikeAccessToken(token) ? "workos_connect" : "malformed";
};
