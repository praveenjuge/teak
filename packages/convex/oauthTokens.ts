import { v } from "convex/values";
import { components } from "./_generated/api";
import {
  internalMutation,
  type MutationCtx,
  type QueryCtx,
  query,
} from "./_generated/server";

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
    if (typeof userId !== "string" || !userId) {
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
