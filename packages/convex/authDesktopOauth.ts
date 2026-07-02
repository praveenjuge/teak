import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import {
  httpAction,
  internalMutation,
  type MutationCtx,
} from "./_generated/server";
import { buildCorsHeaders, jsonResponse } from "./authNative";
import { isWellFormedOAuthToken } from "./oauthTokens";
import { rateLimiter } from "./shared/rateLimits";

// Desktop-only OAuth client. Pinning on this id ensures Raycast / MCP access
// tokens (minted for other clients) can never be upgraded into a full desktop
// session.
const DESKTOP_CLIENT_ID = "teak-desktop";
// 30 days, matching `session.expiresIn` in auth.ts.
const SESSION_TTL_MS = 60 * 60 * 24 * 30 * 1000;
const SESSION_TOKEN_LENGTH = 32;
const SESSION_TOKEN_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const DESKTOP_USER_AGENT = "Teak Desktop";

const exchangeResultValidator = v.union(
  v.object({
    expiresAt: v.number(),
    sessionToken: v.string(),
  }),
  v.null()
);

const rateLimitResultValidator = v.object({
  ok: v.boolean(),
  retryAt: v.optional(v.number()),
});

type ExchangeResult = { expiresAt: number; sessionToken: string } | null;
type RateLimitResult = { ok: boolean; retryAt?: number };

// The Convex adapter stores dates as numbers, so the raw component document
// exposes `accessTokenExpiresAt` as a number.
type OAuthAccessTokenRecord = {
  accessTokenExpiresAt?: number | null;
  clientId?: string | null;
  userId?: string | null;
};

// 32 random alphanumeric chars, matching Better Auth's own session-token shape
// so the value works unchanged against the existing Convex JWT exchange.
const generateSessionToken = (): string => {
  const bytes = new Uint8Array(SESSION_TOKEN_LENGTH);
  crypto.getRandomValues(bytes);
  let token = "";
  for (let index = 0; index < SESSION_TOKEN_LENGTH; index += 1) {
    token += SESSION_TOKEN_ALPHABET[bytes[index] % SESSION_TOKEN_ALPHABET.length];
  }
  return token;
};

const isRateLimitContentionError = (error: unknown): boolean =>
  error instanceof Error &&
  error.message.includes('"rateLimits" table') &&
  error.message.includes(
    "changed while this mutation was being run and on every subsequent retry"
  );

const getClientIp = (request: Request): string => {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const first = forwardedFor?.split(",")[0]?.trim();
  if (first) {
    return first;
  }
  return (
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown-ip"
  );
};

const parseExchangePayload = (
  body: unknown
): { accessToken: string } | null => {
  if (!body || typeof body !== "object") {
    return null;
  }
  const accessToken = (body as { accessToken?: unknown }).accessToken;
  if (typeof accessToken !== "string" || !accessToken.trim()) {
    return null;
  }
  return { accessToken: accessToken.trim() };
};

export const consumeDesktopOauthExchangeLimit = internalMutation({
  args: { key: v.string() },
  returns: rateLimitResultValidator,
  handler: async (ctx, args) => {
    const key = args.key.trim() || "unknown-ip";
    try {
      const result = await rateLimiter.limit(ctx, "desktopOauthExchange", {
        key,
        throws: false,
      });
      return {
        ok: result.ok,
        retryAt:
          typeof result.retryAfter === "number"
            ? Date.now() + result.retryAfter
            : undefined,
      };
    } catch (error) {
      if (isRateLimitContentionError(error)) {
        return { ok: false, retryAt: Date.now() + 1000 };
      }
      throw error;
    }
  },
});

const findDesktopOAuthToken = (
  ctx: MutationCtx,
  accessToken: string
): Promise<OAuthAccessTokenRecord | null> =>
  ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "oauthAccessToken",
    where: [{ field: "accessToken", operator: "eq", value: accessToken }],
  }) as Promise<OAuthAccessTokenRecord | null>;

/**
 * Atomically redeem a desktop OAuth access token for a dedicated Better Auth
 * session. Component sub-calls join this mutation's transaction, so the
 * find -> delete -> create sequence is atomic and strictly single-use: a
 * replayed access token finds no row and yields null.
 */
export const consumeOAuthTokenForSession = internalMutation({
  args: { accessToken: v.string() },
  returns: exchangeResultValidator,
  handler: async (ctx, args) => {
    const accessToken = args.accessToken.trim();
    if (!isWellFormedOAuthToken(accessToken)) {
      return null;
    }

    const record = await findDesktopOAuthToken(ctx, accessToken);
    if (!record) {
      return null;
    }

    const { clientId, userId, accessTokenExpiresAt } = record;
    if (
      clientId !== DESKTOP_CLIENT_ID ||
      typeof userId !== "string" ||
      !userId ||
      typeof accessTokenExpiresAt !== "number" ||
      accessTokenExpiresAt <= Date.now()
    ) {
      return null;
    }

    // Single-use: delete the access token row (cascade removes the paired
    // refresh token) before minting the session.
    await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
      input: {
        model: "oauthAccessToken",
        where: [{ field: "accessToken", operator: "eq", value: accessToken }],
      },
    });

    const now = Date.now();
    const expiresAt = now + SESSION_TTL_MS;
    const sessionToken = generateSessionToken();

    await ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "session",
        data: {
          createdAt: now,
          expiresAt,
          token: sessionToken,
          updatedAt: now,
          userAgent: DESKTOP_USER_AGENT,
          userId,
        },
      },
    });

    return { expiresAt, sessionToken };
  },
});

export const oauthSessionExchangeOptions = httpAction((_ctx, request) => {
  const corsHeaders = buildCorsHeaders(request.headers.get("origin"));
  return Promise.resolve(
    new Response(null, { status: 204, headers: corsHeaders })
  );
});

export const oauthSessionExchange = httpAction(async (ctx, request) => {
  const corsHeaders = buildCorsHeaders(request.headers.get("origin"));

  if (request.method !== "POST") {
    return jsonResponse(
      405,
      { code: "METHOD_NOT_ALLOWED", error: "Method not allowed" },
      corsHeaders
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(
      400,
      { code: "INVALID_JSON", error: "Invalid JSON body" },
      corsHeaders
    );
  }

  const parsed = parseExchangePayload(body);
  if (!(parsed && isWellFormedOAuthToken(parsed.accessToken))) {
    return jsonResponse(
      400,
      { code: "INVALID_PAYLOAD", error: "Missing or malformed access token" },
      corsHeaders
    );
  }

  const limit: RateLimitResult = await ctx.runMutation(
    (internal as any).authDesktopOauth.consumeDesktopOauthExchangeLimit,
    { key: getClientIp(request) }
  );
  if (!limit.ok) {
    return jsonResponse(
      429,
      {
        code: "RATE_LIMITED",
        error: "Too many requests",
        retryAt: limit.retryAt,
      },
      corsHeaders
    );
  }

  const result: ExchangeResult = await ctx.runMutation(
    (internal as any).authDesktopOauth.consumeOAuthTokenForSession,
    { accessToken: parsed.accessToken }
  );

  if (!result) {
    return jsonResponse(
      401,
      { code: "UNAUTHORIZED", error: "Invalid or expired access token" },
      corsHeaders
    );
  }

  return jsonResponse(200, result, corsHeaders);
});
