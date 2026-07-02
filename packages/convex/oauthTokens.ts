import { v } from "convex/values";
import { components } from "./_generated/api";
import { internalMutation, type MutationCtx } from "./_generated/server";

// Better Auth's `mcp`/oidc authorization server mints opaque access and refresh
// tokens as 32-character alphabetic strings (generateRandomString(32, "a-z",
// "A-Z", "0-9") produces alphanumerics, but the access/refresh token model is
// documented as `/^[A-Za-z]{32}$/`). This cheap structural check lets the REST
// auth path discriminate OAuth bearer tokens from `teakapi_` keys and reject
// junk before any database read — mirroring `isWellFormedApiKey`.
const OAUTH_TOKEN_PATTERN = /^[A-Za-z]{32}$/;

export const isWellFormedOAuthToken = (token: string): boolean =>
  OAUTH_TOKEN_PATTERN.test(token);

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

// The Convex adapter stores dates as numbers, so the raw component document
// exposes `accessTokenExpiresAt` as a number. Type the fields we read defensively.
interface OAuthAccessTokenRecord {
  _id: string;
  accessTokenExpiresAt?: number | null;
  clientId?: string | null;
  userId?: string | null;
}

const findOAuthAccessToken = (
  ctx: MutationCtx,
  accessToken: string
): Promise<OAuthAccessTokenRecord | null> =>
  ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "oauthAccessToken",
    where: [{ field: "accessToken", operator: "eq", value: accessToken }],
  }) as Promise<OAuthAccessTokenRecord | null>;

const userExists = async (
  ctx: MutationCtx,
  userId: string
): Promise<boolean> => {
  const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "user",
    where: [{ field: "_id", operator: "eq", value: userId }],
  });
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
