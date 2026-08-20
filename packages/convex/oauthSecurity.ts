import { createAuthMiddleware } from "@better-auth/core/api";
import type {
  BetterAuthOptions,
  BetterAuthPlugin,
  DBAdapter,
} from "better-auth";
import { APIError, getSessionFromCtx } from "better-auth/api";
import { isFirstPartyOAuthClientId } from "./oauthClients";

const MCP_AUTHORIZE_PATH = "/mcp/authorize";
const OAUTH_CONSENT_PATH = "/oauth2/consent";
const MCP_SESSION_PATH = "/mcp/get-session";
const MCP_TOKEN_PATH = "/mcp/token";
const USED_REFRESH_PREFIX = "teak-oauth-used-refresh:";

interface OAuthTokenResponse {
  access_token?: string;
  refresh_token?: string;
}

interface OAuthTokenRecord {
  accessToken?: string;
  clientId?: string;
  refreshTokenExpiresAt?: Date;
  userId?: string;
}

interface OAuthConsentVerification {
  expiresAt?: Date | number;
  value?: string;
}

const bodyValue = (body: unknown, key: string): string | null => {
  if (body instanceof FormData) {
    const value = body.get(key);
    return typeof value === "string" ? value : null;
  }
  if (!body || typeof body !== "object") {
    return null;
  }
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
};

const setBodyValue = (body: unknown, key: string, value: string): unknown => {
  if (body instanceof FormData) {
    const next = new FormData();
    body.forEach((entry, entryKey) => {
      next.append(entryKey, entry);
    });
    next.set(key, value);
    return next;
  }
  if (!body || typeof body !== "object") {
    return body;
  }
  return { ...(body as Record<string, unknown>), [key]: value };
};

const hashRefreshToken = async (token: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
};

const usedRefreshIdentifier = async (token: string): Promise<string> =>
  `${USED_REFRESH_PREFIX}${await hashRefreshToken(token)}`;

const revokeTokenFamily = async (
  adapter: Pick<DBAdapter<BetterAuthOptions>, "deleteMany">,
  record: OAuthTokenRecord
): Promise<void> => {
  if (!(record.clientId && record.userId)) {
    return;
  }
  await adapter.deleteMany({
    model: "oauthAccessToken",
    where: [
      { field: "clientId", value: record.clientId },
      { field: "userId", value: record.userId },
    ],
  });
};

const parseUsedRefreshRecord = (value: unknown): OAuthTokenRecord | null => {
  if (typeof value !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as OAuthTokenRecord;
    return parsed.clientId && parsed.userId ? parsed : null;
  } catch {
    return null;
  }
};

const responseJson = async (
  returned: unknown
): Promise<OAuthTokenResponse | null> => {
  if (returned instanceof Response) {
    if (!returned.ok) {
      return null;
    }
    return (await returned.clone().json()) as OAuthTokenResponse;
  }
  if (!returned || typeof returned !== "object") {
    return null;
  }
  return returned as OAuthTokenResponse;
};

export const requireExternalClientConsent = (
  clientId: unknown,
  prompt: unknown
): string | undefined => {
  if (typeof clientId !== "string" || isFirstPartyOAuthClientId(clientId)) {
    return typeof prompt === "string" ? prompt : undefined;
  }

  // The 1.6.x MCP implementation checks exact equality rather than parsing
  // the OAuth prompt set. Return only `consent` so combinations such as
  // `login consent` cannot accidentally fall through to silent issuance.
  return "consent";
};

/**
 * Compensating controls for Better Auth 1.6.x's legacy MCP provider.
 *
 * The provider remains standards-compatible for dynamic MCP clients, but an
 * external client can no longer turn a login into a silent grant. Refreshes
 * rotate the stored credential and retain the original family's absolute
 * expiry instead of extending access indefinitely. The internal MCP session
 * lookup also receives only the fields it needs, never the paired refresh
 * token that the upstream endpoint otherwise exposes over HTTP.
 */
export const teakOAuthSecurity = (): BetterAuthPlugin => ({
  id: "teak-oauth-security",
  hooks: {
    before: [
      {
        matcher: (context) => context.path === MCP_AUTHORIZE_PATH,
        handler: createAuthMiddleware((context) => {
          const query = context.query ?? {};
          const prompt = requireExternalClientConsent(
            query.client_id,
            query.prompt
          );
          return Promise.resolve({
            context: {
              query: { ...query, ...(prompt ? { prompt } : {}) },
            },
          });
        }),
      },
      {
        matcher: (context) => context.path === MCP_TOKEN_PATH,
        handler: createAuthMiddleware(async (context) => {
          if (bodyValue(context.body, "grant_type") !== "refresh_token") {
            return;
          }

          const refreshToken = bodyValue(context.body, "refresh_token");
          if (!refreshToken) {
            return;
          }

          const adapter = context.context.adapter;
          const oldToken = (await adapter.findOne({
            model: "oauthAccessToken",
            where: [{ field: "refreshToken", value: refreshToken }],
          })) as OAuthTokenRecord | null;
          if (!oldToken) {
            const replayMarker = (await adapter.findOne({
              model: "verification",
              where: [
                {
                  field: "identifier",
                  value: await usedRefreshIdentifier(refreshToken),
                },
              ],
            })) as { value?: string } | null;
            const replayedFamily = parseUsedRefreshRecord(replayMarker?.value);
            if (replayedFamily) {
              await revokeTokenFamily(adapter, replayedFamily);
            }
            throw new APIError("UNAUTHORIZED", {
              error: "invalid_grant",
              error_description: "invalid refresh token",
            });
          }

          const claimedRefreshToken = `claimed-${crypto.randomUUID()}`;
          const claimed = (await adapter.update({
            model: "oauthAccessToken",
            where: [{ field: "refreshToken", value: refreshToken }],
            update: {
              refreshToken: claimedRefreshToken,
              updatedAt: new Date(),
            },
          })) as OAuthTokenRecord | null;
          if (!claimed) {
            const replayMarker = (await adapter.findOne({
              model: "verification",
              where: [
                {
                  field: "identifier",
                  value: await usedRefreshIdentifier(refreshToken),
                },
              ],
            })) as { value?: string } | null;
            const replayedFamily = parseUsedRefreshRecord(replayMarker?.value);
            if (replayedFamily) {
              await revokeTokenFamily(adapter, replayedFamily);
            }
            throw new APIError("UNAUTHORIZED", {
              error: "invalid_grant",
              error_description: "refresh token was already used",
            });
          }

          await adapter.create({
            model: "verification",
            data: {
              identifier: await usedRefreshIdentifier(refreshToken),
              value: JSON.stringify({
                clientId: oldToken.clientId,
                userId: oldToken.userId,
              }),
              expiresAt: oldToken.refreshTokenExpiresAt ?? new Date(),
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          });
          return {
            context: {
              body: setBodyValue(
                context.body,
                "refresh_token",
                claimedRefreshToken
              ),
            },
          };
        }),
      },
      {
        matcher: (context) => context.path === OAUTH_CONSENT_PATH,
        handler: createAuthMiddleware(async (context) => {
          const consentCode = bodyValue(context.body, "consent_code");
          const session = await getSessionFromCtx(context);
          if (!(consentCode && session?.user.id)) {
            throw new APIError("UNAUTHORIZED", {
              message: "Invalid authorization request",
            });
          }

          const verification = (await context.context.adapter.findOne({
            model: "verification",
            where: [{ field: "identifier", value: consentCode }],
          })) as OAuthConsentVerification | null;
          if (!(verification?.value && verification.expiresAt)) {
            throw new APIError("UNAUTHORIZED", {
              message: "Invalid authorization request",
            });
          }

          let userId: unknown;
          try {
            userId = (JSON.parse(verification.value) as { userId?: unknown })
              .userId;
          } catch {
            throw new APIError("UNAUTHORIZED", {
              message: "Invalid authorization request",
            });
          }
          const expiresAt =
            verification.expiresAt instanceof Date
              ? verification.expiresAt.getTime()
              : verification.expiresAt;
          if (expiresAt <= Date.now() || userId !== session.user.id) {
            throw new APIError("UNAUTHORIZED", {
              message: "Invalid authorization request",
            });
          }
        }),
      },
    ],
    after: [
      {
        matcher: (context) => context.path === MCP_TOKEN_PATH,
        handler: createAuthMiddleware(async (context) => {
          if (bodyValue(context.body, "grant_type") !== "refresh_token") {
            return;
          }

          const claimedRefreshToken = bodyValue(context.body, "refresh_token");
          if (!claimedRefreshToken) {
            return;
          }
          const response = await responseJson(context.context.returned);
          if (!(response?.refresh_token && response.access_token)) {
            return;
          }

          const oldToken = (await context.context.adapter.findOne({
            model: "oauthAccessToken",
            where: [{ field: "refreshToken", value: claimedRefreshToken }],
          })) as OAuthTokenRecord | null;
          if (
            !(
              oldToken?.refreshTokenExpiresAt &&
              oldToken.clientId &&
              oldToken.userId
            )
          ) {
            return;
          }

          await context.context.adapter.update({
            model: "oauthAccessToken",
            where: [{ field: "accessToken", value: response.access_token }],
            update: {
              refreshTokenExpiresAt: oldToken.refreshTokenExpiresAt,
              updatedAt: new Date(),
            },
          });
          await context.context.adapter.delete({
            model: "oauthAccessToken",
            where: [{ field: "refreshToken", value: claimedRefreshToken }],
          });
        }),
      },
      {
        matcher: (context) => context.path === MCP_SESSION_PATH,
        handler: createAuthMiddleware((context) => {
          const returned = context.context.returned;
          if (!returned || typeof returned !== "object") {
            return Promise.resolve();
          }
          const token = returned as OAuthTokenRecord;
          context.context.returned = token.userId
            ? { clientId: token.clientId ?? null, userId: token.userId }
            : null;
          return Promise.resolve();
        }),
      },
    ],
  },
});
