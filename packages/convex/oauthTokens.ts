import { v } from "convex/values";
import { components } from "./_generated/api";
import {
  type ActionCtx,
  action,
  internalMutation,
  type MutationCtx,
  type QueryCtx,
  query,
} from "./_generated/server";
import { isFirstPartyOAuthClientId } from "./oauthClients";

// Better Auth's `mcp`/oidc authorization server mints opaque access and refresh
// tokens with `generateRandomString(32, ...)`. Today the mcp plugin uses the
// alphabetic alphabet ("a-z", "A-Z"), but Better Auth's generator alphabet is
// alphanumeric in general and can include `0-9`, so we accept 32-char
// alphanumerics to avoid rejecting a valid token that happens to contain a
// digit. This cheap structural check still lets the REST auth path discriminate
// OAuth bearer tokens from `teakapi_` keys (which carry the `teakapi_` prefix
// and are checked first) and reject obvious junk before any database read —
// mirroring `isWellFormedApiKey`.
const OAUTH_TOKEN_PATTERN = /^[A-Za-z0-9]{32}$/;

export const isWellFormedOAuthToken = (token: string): boolean =>
  OAUTH_TOKEN_PATTERN.test(token);

// Better Auth's oidc-provider schema stores the opaque OAuth tokens on the
// `oauthAccessToken` model under the string field `accessToken` (paired with
// `refreshToken`). Verified against better-auth 1.6.11
// (`plugins/oidc-provider/schema`): the mcp plugin both writes and reads that
// exact field, so our adapter lookup must query it verbatim. Centralised here
// as the single source of truth shared with the desktop exchange path.
export const OAUTH_ACCESS_TOKEN_MODEL = "oauthAccessToken";
export const OAUTH_ACCESS_TOKEN_FIELD = "accessToken";

const OAUTH_ACCESS = "full_access" as const;

const validatedOAuthTokenValidator = v.union(
  v.object({
    access: v.literal(OAUTH_ACCESS),
    keyId: v.string(),
    rateLimitKey: v.string(),
    source: v.literal("oauth"),
    userId: v.string(),
  }),
  v.null()
);

const oauthUserInfoValidator = v.union(
  v.object({
    email: v.optional(v.string()),
    email_verified: v.optional(v.boolean()),
    name: v.optional(v.string()),
    sub: v.string(),
  }),
  v.null()
);

// The Convex adapter stores dates as numbers, so the raw component document
// exposes `accessTokenExpiresAt` as a number. Type the fields we read defensively.
interface OAuthAccessTokenRecord {
  _id: string;
  accessTokenExpiresAt?: number | null;
  clientId?: string | null;
  createdAt?: number | null;
  refreshTokenExpiresAt?: number | null;
  scopes?: string | null;
  userId?: string | null;
}

interface AuthUserRecord {
  _id: string;
  email?: string | null;
  emailVerified?: boolean | null;
  name?: string | null;
}

const findOAuthAccessToken = (
  ctx: MutationCtx | QueryCtx,
  accessToken: string
): Promise<OAuthAccessTokenRecord | null> =>
  ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: OAUTH_ACCESS_TOKEN_MODEL,
    where: [
      { field: OAUTH_ACCESS_TOKEN_FIELD, operator: "eq", value: accessToken },
    ],
  }) as Promise<OAuthAccessTokenRecord | null>;

const findAuthUser = (
  ctx: MutationCtx | QueryCtx,
  userId: string
): Promise<AuthUserRecord | null> =>
  ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "user",
    where: [{ field: "_id", operator: "eq", value: userId }],
  }) as Promise<AuthUserRecord | null>;

const userExists = async (
  ctx: MutationCtx,
  userId: string
): Promise<boolean> => {
  const user = await findAuthUser(ctx, userId);
  return Boolean(user);
};

const hasApprovedClientAccess = async (
  ctx: MutationCtx | QueryCtx,
  record: OAuthAccessTokenRecord,
  userId: string,
  clientId: string
): Promise<boolean> => {
  if (isFirstPartyOAuthClientId(clientId)) {
    return true;
  }

  const consent = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "oauthConsent",
    where: [
      { field: "clientId", operator: "eq", value: clientId },
      { field: "userId", operator: "eq", value: userId },
      { field: "consentGiven", operator: "eq", value: true },
    ],
  })) as { scopes?: string | null } | null;
  if (!consent) {
    return false;
  }

  const grantedScopes = new Set((consent.scopes ?? "").split(/\s+/));
  return (record.scopes ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .every((scope) => grantedScopes.has(scope));
};

/**
 * Resolve a Teak user from an opaque OAuth access token.
 *
 * Returns `null` for any invalid, expired, or orphaned token. Rate limiting is
 * keyed on `oauth:<clientId>:<userId>` so it stays stable across the rotating
 * access tokens a client receives on refresh.
 */
export const validateOAuthAccessToken = internalMutation({
  args: { token: v.string() },
  returns: validatedOAuthTokenValidator,
  handler: async (ctx, args) => {
    const token = args.token.trim();
    if (!isWellFormedOAuthToken(token)) {
      return null;
    }

    const record = await findOAuthAccessToken(ctx, token);
    if (!record) {
      return null;
    }

    const expiresAt = record.accessTokenExpiresAt;
    if (typeof expiresAt !== "number" || expiresAt <= Date.now()) {
      return null;
    }

    const userId = record.userId;
    const clientId = record.clientId;
    if (
      typeof userId !== "string" ||
      !userId ||
      typeof clientId !== "string" ||
      !clientId
    ) {
      return null;
    }

    if (!(await userExists(ctx, userId))) {
      return null;
    }

    if (!(await hasApprovedClientAccess(ctx, record, userId, clientId))) {
      return null;
    }

    return {
      access: OAUTH_ACCESS,
      keyId: String(record._id),
      rateLimitKey: `oauth:${clientId}:${userId}`,
      source: "oauth" as const,
      userId,
    };
  },
});

export const getOAuthUserInfo = query({
  args: { token: v.string() },
  returns: oauthUserInfoValidator,
  handler: async (ctx, args) => {
    const token = args.token.trim();
    if (!isWellFormedOAuthToken(token)) {
      return null;
    }

    const record = await findOAuthAccessToken(ctx, token);
    if (!record) {
      return null;
    }

    const expiresAt = record.accessTokenExpiresAt;
    if (typeof expiresAt !== "number" || expiresAt <= Date.now()) {
      return null;
    }

    const userId = record.userId;
    const clientId = record.clientId;
    if (
      typeof userId !== "string" ||
      !userId ||
      typeof clientId !== "string" ||
      !clientId
    ) {
      return null;
    }

    if (!(await hasApprovedClientAccess(ctx, record, userId, clientId))) {
      return null;
    }

    const user = await findAuthUser(ctx, userId);
    if (!user) {
      return null;
    }

    return {
      sub: userId,
      ...(typeof user.email === "string" ? { email: user.email } : {}),
      ...(typeof user.emailVerified === "boolean"
        ? { email_verified: user.emailVerified }
        : {}),
      ...(typeof user.name === "string" ? { name: user.name } : {}),
    };
  },
});

const oauthConnectionValidator = v.object({
  clientId: v.string(),
  connectedAt: v.number(),
  expiresAt: v.optional(v.number()),
  name: v.string(),
});

const oauthConsentRequestValidator = v.union(
  v.object({
    clientId: v.string(),
    name: v.string(),
    scopes: v.array(v.string()),
  }),
  v.null()
);

const requireAuthenticatedUserId = async (
  ctx: ActionCtx | MutationCtx | QueryCtx
): Promise<string> => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.subject) {
    throw new Error("User must be authenticated");
  }
  return identity.subject;
};

export const getOAuthConsentRequest = query({
  args: { consentCode: v.string() },
  returns: oauthConsentRequestValidator,
  handler: async (ctx, args) => {
    const userId = await requireAuthenticatedUserId(ctx);
    const consentCode = args.consentCode.trim();
    if (!consentCode) {
      return null;
    }

    const verification = (await ctx.runQuery(
      components.betterAuth.adapter.findOne,
      {
        model: "verification",
        where: [{ field: "identifier", operator: "eq", value: consentCode }],
      }
    )) as { expiresAt?: number; value?: string } | null;
    if (
      !verification?.value ||
      typeof verification.expiresAt !== "number" ||
      verification.expiresAt <= Date.now()
    ) {
      return null;
    }

    let request: {
      clientId?: unknown;
      requireConsent?: unknown;
      scope?: unknown;
      userId?: unknown;
    };
    try {
      request = JSON.parse(verification.value) as typeof request;
    } catch {
      return null;
    }
    if (
      request.userId !== userId ||
      request.requireConsent !== true ||
      typeof request.clientId !== "string" ||
      !Array.isArray(request.scope) ||
      !request.scope.every((scope) => typeof scope === "string")
    ) {
      return null;
    }

    const application = (await ctx.runQuery(
      components.betterAuth.adapter.findOne,
      {
        model: "oauthApplication",
        where: [{ field: "clientId", operator: "eq", value: request.clientId }],
      }
    )) as { name?: string | null } | null;
    if (!application) {
      return null;
    }

    return {
      clientId: request.clientId,
      name: application.name?.trim() || "External app",
      scopes: request.scope,
    };
  },
});

export const listOAuthConnections = query({
  args: {},
  returns: v.array(oauthConnectionValidator),
  handler: async (ctx) => {
    const userId = await requireAuthenticatedUserId(ctx);
    const tokens: OAuthAccessTokenRecord[] = [];
    let cursor: string | null = null;
    let isDone = false;
    while (!isDone) {
      const result = (await ctx.runQuery(
        components.betterAuth.adapter.findMany,
        {
          model: OAUTH_ACCESS_TOKEN_MODEL,
          where: [{ field: "userId", operator: "eq", value: userId }],
          paginationOpts: { cursor, numItems: 100 },
        }
      )) as {
        continueCursor?: string;
        isDone?: boolean;
        page?: OAuthAccessTokenRecord[];
      };
      tokens.push(...(result.page ?? []));
      cursor = result.continueCursor ?? null;
      isDone = result.isDone ?? !cursor;
    }

    const byClient = new Map<
      string,
      { connectedAt: number; expiresAt?: number }
    >();
    for (const token of tokens) {
      if (!token.clientId) {
        continue;
      }
      const connectedAt = token.createdAt ?? 0;
      const existing = byClient.get(token.clientId);
      let expiresAt = existing?.expiresAt;
      if (typeof token.refreshTokenExpiresAt === "number") {
        expiresAt = Math.max(expiresAt ?? 0, token.refreshTokenExpiresAt);
      }
      byClient.set(token.clientId, {
        connectedAt: existing
          ? Math.min(existing.connectedAt, connectedAt)
          : connectedAt,
        ...(expiresAt ? { expiresAt } : {}),
      });
    }

    return await Promise.all(
      [...byClient.entries()].map(async ([clientId, connection]) => {
        const application = (await ctx.runQuery(
          components.betterAuth.adapter.findOne,
          {
            model: "oauthApplication",
            where: [{ field: "clientId", operator: "eq", value: clientId }],
          }
        )) as { name?: string | null } | null;
        return {
          clientId,
          connectedAt: connection.connectedAt,
          ...(connection.expiresAt ? { expiresAt: connection.expiresAt } : {}),
          name: application?.name?.trim() || "External app",
        };
      })
    );
  },
});

export const revokeOAuthConnection = action({
  args: { clientId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireAuthenticatedUserId(ctx);
    const clientId = args.clientId.trim();
    if (!clientId) {
      throw new Error("OAuth client is required");
    }

    for (const model of [OAUTH_ACCESS_TOKEN_MODEL, "oauthConsent"] as const) {
      let deleted = 0;
      do {
        const result = (await ctx.runQuery(
          components.betterAuth.adapter.findMany,
          {
            model,
            where: [
              { field: "clientId", operator: "eq", value: clientId },
              { field: "userId", operator: "eq", value: userId },
            ],
            paginationOpts: { cursor: null, numItems: 100 },
          }
        )) as { page?: Array<{ _id: string }> };
        const rows = result.page ?? [];
        deleted = rows.length;
        await Promise.all(
          rows.map((row) =>
            ctx.runMutation(components.betterAuth.adapter.deleteOne, {
              input: {
                model,
                where: [{ field: "_id", operator: "eq", value: row._id }],
              },
            })
          )
        );
      } while (deleted === 100);
    }
    return null;
  },
});
