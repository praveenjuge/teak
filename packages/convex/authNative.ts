import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  httpAction,
  internalMutation,
  type MutationCtx,
  mutation,
} from "./_generated/server";
import { resolveTeakDevAppUrl } from "./devUrls";
import { mintDedicatedSession } from "./shared/dedicatedSessions";
import { rateLimiter } from "./shared/rateLimits";

const NATIVE_AUTH_CODE_TTL_MS = 5 * 60 * 1000;
const NATIVE_AUTH_ALLOWED_ORIGINS = new Set([
  "http://localhost:1420",
  "http://127.0.0.1:1420",
  resolveTeakDevAppUrl(process.env),
  "https://app.teakvault.com",
]);

const NATIVE_AUTH_SURFACES = [
  "desktop",
  "safari-macos",
  "safari-ios",
  "safari-ipados",
  "browser-extension",
] as const;

const PKCE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;
const STATE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9-]{16,128}$/;

export const nativeAuthSurfaceValidator = v.union(
  v.literal("desktop"),
  v.literal("safari-macos"),
  v.literal("safari-ios"),
  v.literal("safari-ipados"),
  v.literal("browser-extension")
);

const createNativeAuthCodeResultValidator = v.object({
  expiresAt: v.number(),
});

const exchangeNativeAuthResultValidator = v.object({
  sessionToken: v.string(),
  expiresAt: v.number(),
});

const rateLimitResultValidator = v.object({
  ok: v.boolean(),
  retryAt: v.optional(v.number()),
});

type RateLimitResult = { ok: boolean; retryAt?: number };

const BASE64_URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

type NativeAuthCodeRecord = Doc<"nativeAuthCodes">;
type NativeAuthSurface = (typeof NATIVE_AUTH_SURFACES)[number];

// Human-readable per-surface labels stored on the dedicated session's
// `userAgent` so sessions are distinguishable in the dashboard.
const SURFACE_USER_AGENTS: Record<NativeAuthSurface, string> = {
  desktop: "Teak Desktop",
  "safari-macos": "Teak Safari (macOS)",
  "safari-ios": "Teak Safari (iOS)",
  "safari-ipados": "Teak Safari (iPadOS)",
  "browser-extension": "Teak Browser Extension",
};

const toBase64Url = (bytes: Uint8Array): string => {
  let output = "";

  for (let index = 0; index < bytes.length; index += 3) {
    const byte1 = bytes[index] ?? 0;
    const byte2 = bytes[index + 1] ?? 0;
    const byte3 = bytes[index + 2] ?? 0;
    const triplet = (byte1 << 16) | (byte2 << 8) | byte3;

    output += BASE64_URL_ALPHABET[(triplet >> 18) & 63];
    output += BASE64_URL_ALPHABET[(triplet >> 12) & 63];

    if (index + 1 < bytes.length) {
      output += BASE64_URL_ALPHABET[(triplet >> 6) & 63];
    }
    if (index + 2 < bytes.length) {
      output += BASE64_URL_ALPHABET[triplet & 63];
    }
  }

  return output;
};

const hashVerifierToChallenge = async (
  codeVerifier: string
): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(codeVerifier)
  );
  return toBase64Url(new Uint8Array(digest));
};

const timingSafeEqual = (left: string, right: string): boolean => {
  const maxLength = Math.max(left.length, right.length);
  let mismatch = left.length === right.length ? 0 : 1;

  for (let index = 0; index < maxLength; index += 1) {
    const leftCode = left.charCodeAt(index) || 0;
    const rightCode = right.charCodeAt(index) || 0;
    mismatch |= leftCode ^ rightCode;
  }

  return mismatch === 0;
};

const isNativeAuthSurface = (value: string): value is NativeAuthSurface =>
  NATIVE_AUTH_SURFACES.includes(value as NativeAuthSurface);

const assertNativeStateInputs = (
  codeVerifier: string,
  deviceId: string,
  state: string
) => {
  if (!PKCE_VERIFIER_PATTERN.test(codeVerifier)) {
    throw new ConvexError({
      code: "INVALID_CODE_VERIFIER",
      message: "Invalid PKCE verifier",
    });
  }

  if (!DEVICE_ID_PATTERN.test(deviceId)) {
    throw new ConvexError({
      code: "INVALID_DEVICE_ID",
      message: "Invalid native device id",
    });
  }

  if (!STATE_PATTERN.test(state)) {
    throw new ConvexError({
      code: "INVALID_STATE",
      message: "Invalid auth state",
    });
  }
};

export const jsonResponse = (
  status: number,
  body: unknown,
  headers: HeadersInit = {}
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });

const isAllowedOrigin = (origin: string): boolean => {
  if (NATIVE_AUTH_ALLOWED_ORIGINS.has(origin)) {
    return true;
  }

  return /^https:\/\/([a-z0-9-]+\.)*teakvault\.com$/i.test(origin);
};

export const buildCorsHeaders = (origin: string | null): HeadersInit => {
  const resolvedOrigin =
    origin && isAllowedOrigin(origin) ? origin : "https://app.teakvault.com";

  return {
    Vary: "Origin",
    "Access-Control-Allow-Origin": resolvedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
};

// Defined here (rather than in authDesktopOauth) so both the desktop OAuth
// exchange and the native poll endpoint can share it without a circular import
// (authDesktopOauth already imports from this module).
export const getClientIp = (request: Request): string => {
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

export const isRateLimitContentionError = (error: unknown): boolean =>
  error instanceof Error &&
  error.message.includes('"rateLimits" table') &&
  error.message.includes(
    "changed while this mutation was being run and on every subsequent retry"
  );

// Preserves the SESSION_INVALID / 401 contract shipped Safari clients handle:
// if the web session that authorized this device is gone, reject the poll.
// Note: the token we ultimately return is a fresh dedicated session, not this
// paired one — this only validates that the authorizing session was real.
const assertPairedSessionValid = async (
  ctx: MutationCtx,
  record: NativeAuthCodeRecord,
  now: number
): Promise<void> => {
  const session = await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "session",
    where: [{ field: "_id", value: record.sessionId }],
  });

  if (
    !session ||
    typeof session.token !== "string" ||
    session.expiresAt <= now ||
    session.userId !== record.userId
  ) {
    throw new ConvexError({
      code: "SESSION_INVALID",
      message: "Session is no longer valid",
    });
  }
};

const pickLatestEligibleRecord = ({
  records,
  now,
  expectedChallenge,
}: {
  records: NativeAuthCodeRecord[];
  now: number;
  expectedChallenge: string;
}): NativeAuthCodeRecord | null => {
  let selected: NativeAuthCodeRecord | null = null;

  for (const record of records) {
    if (record.expiresAt <= now || record.consumedAt) {
      continue;
    }

    if (!timingSafeEqual(record.codeChallenge, expectedChallenge)) {
      continue;
    }

    if (!(selected && selected.createdAt >= record.createdAt)) {
      selected = record;
    }
  }

  return selected;
};

const parsePollPayload = (body: unknown) => {
  if (!body || typeof body !== "object") {
    return null;
  }

  const payload = body as {
    codeVerifier?: unknown;
    deviceId?: unknown;
    state?: unknown;
  };

  if (
    typeof payload.codeVerifier !== "string" ||
    typeof payload.deviceId !== "string" ||
    typeof payload.state !== "string"
  ) {
    return null;
  }

  return {
    codeVerifier: payload.codeVerifier.trim(),
    deviceId: payload.deviceId.trim(),
    state: payload.state.trim(),
  };
};

export const createNativeAuthCode = mutation({
  args: {
    deviceId: v.string(),
    codeChallenge: v.string(),
    state: v.string(),
    surface: nativeAuthSurfaceValidator,
  },
  returns: createNativeAuthCodeResultValidator,
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    const sessionId =
      user && typeof user.sessionId === "string" ? user.sessionId : null;
    if (!(user?.subject && sessionId)) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "User must be authenticated",
      });
    }

    if (!isNativeAuthSurface(args.surface)) {
      throw new ConvexError({
        code: "INVALID_SURFACE",
        message: "Invalid native auth surface",
      });
    }
    if (!DEVICE_ID_PATTERN.test(args.deviceId)) {
      throw new ConvexError({
        code: "INVALID_DEVICE_ID",
        message: "Invalid native device id",
      });
    }
    if (!PKCE_CHALLENGE_PATTERN.test(args.codeChallenge)) {
      throw new ConvexError({
        code: "INVALID_CODE_CHALLENGE",
        message: "Invalid PKCE challenge",
      });
    }
    if (!STATE_PATTERN.test(args.state)) {
      throw new ConvexError({
        code: "INVALID_STATE",
        message: "Invalid auth state",
      });
    }

    const now = Date.now();
    const expiresAt = now + NATIVE_AUTH_CODE_TTL_MS;

    await ctx.db.insert("nativeAuthCodes", {
      sessionId,
      userId: user.subject,
      deviceId: args.deviceId,
      codeChallenge: args.codeChallenge,
      state: args.state,
      surface: args.surface,
      expiresAt,
      consumedAt: undefined,
      createdAt: now,
    });

    return { expiresAt };
  },
});

export const consumeNativeAuthByState = internalMutation({
  args: {
    codeVerifier: v.string(),
    deviceId: v.string(),
    state: v.string(),
  },
  returns: v.union(exchangeNativeAuthResultValidator, v.null()),
  handler: async (ctx, args) => {
    assertNativeStateInputs(args.codeVerifier, args.deviceId, args.state);

    const now = Date.now();
    const expectedChallenge = await hashVerifierToChallenge(args.codeVerifier);

    const candidateRecords = await ctx.db
      .query("nativeAuthCodes")
      .withIndex("by_device_state_consumed", (q) =>
        q
          .eq("deviceId", args.deviceId)
          .eq("state", args.state)
          .eq("consumedAt", undefined)
      )
      .collect();

    const record = pickLatestEligibleRecord({
      records: candidateRecords,
      now,
      expectedChallenge,
    });

    if (!record) {
      return null;
    }

    await ctx.db.patch(record._id, {
      consumedAt: now,
    });

    // Reject if the authorizing web session is gone (preserves the Safari
    // SESSION_INVALID contract), then mint a fresh dedicated session so the
    // device holds its own long-lived, independently revocable credential.
    await assertPairedSessionValid(ctx, record, now);

    return mintDedicatedSession(ctx, {
      userId: record.userId,
      userAgent: SURFACE_USER_AGENTS[record.surface],
    });
  },
});

export const consumeNativeAuthPollLimit = internalMutation({
  args: { key: v.string() },
  returns: rateLimitResultValidator,
  handler: async (ctx, args) => {
    const key = args.key.trim() || "unknown-ip";
    try {
      const result = await rateLimiter.limit(ctx, "nativeAuthPoll", {
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

export const exchangeNativeAuthOptions = httpAction((_ctx, request) => {
  const corsHeaders = buildCorsHeaders(request.headers.get("origin"));
  return Promise.resolve(
    new Response(null, { status: 204, headers: corsHeaders })
  );
});

export const pollNativeAuthCode = httpAction(async (ctx, request) => {
  const corsHeaders = buildCorsHeaders(request.headers.get("origin"));

  if (request.method !== "POST") {
    return jsonResponse(
      405,
      {
        code: "METHOD_NOT_ALLOWED",
        error: "Method not allowed",
      },
      corsHeaders
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse(
      400,
      {
        code: "INVALID_JSON",
        error: "Invalid JSON body",
      },
      corsHeaders
    );
  }

  const parsed = parsePollPayload(payload);
  if (!parsed) {
    return jsonResponse(
      400,
      {
        code: "INVALID_PAYLOAD",
        error: "Missing required native auth fields",
      },
      corsHeaders
    );
  }

  const limit: RateLimitResult = await ctx.runMutation(
    (internal as any).authNative.consumeNativeAuthPollLimit,
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

  try {
    const result = await ctx.runMutation(
      (internal as any).authNative.consumeNativeAuthByState,
      parsed
    );

    if (!result) {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    return jsonResponse(200, result, corsHeaders);
  } catch (error) {
    if (error instanceof ConvexError) {
      const code = String((error.data as { code?: unknown })?.code ?? "ERROR");
      const message = String(
        (error.data as { message?: unknown })?.message ??
          "Native auth polling failed"
      );
      const status = code === "SESSION_INVALID" ? 401 : 400;

      return jsonResponse(
        status,
        {
          code,
          error: message,
        },
        corsHeaders
      );
    }

    return jsonResponse(
      500,
      {
        code: "INTERNAL_ERROR",
        error: "Native auth polling failed",
      },
      corsHeaders
    );
  }
});
