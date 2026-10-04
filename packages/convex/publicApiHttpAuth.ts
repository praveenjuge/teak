/**
 * Public API authentication: bearer validation (API keys + OAuth tokens),
 * per-identity rate limiting, and idempotency-key reservation/replay.
 * Split out of `publicApiHttp.ts`, kept behavior-identical.
 */
import { internal } from "./_generated/api";
import { type ActionCtx, env } from "./_generated/server";
import { readAuthPrimary } from "./env";
import { isWellFormedOAuthToken } from "./oauthTokens";
import {
  AUTH_INTERNAL_ERROR,
  type AuthorizedUser,
  type AuthResult,
  errorResponse,
  isRateLimitContentionError,
  json,
  parseBearerToken,
  parseOptionalString,
  RATE_LIMIT_CONTENTION_ERROR,
  RATE_LIMITED_ERROR,
  sha256,
} from "./publicApiHttpShared";
import {
  resolveStoredUserId,
  resolveWorkosApiKeyOwner,
} from "./securitySessions";
import { isWellFormedApiKey } from "./shared/apiKeyFormat";
import { WORKOS_RESOURCES } from "./shared/workosResources";
import { verifyWorkosConnectToken, type WorkosResource } from "./workosTokens";

const buildIdempotentResponse = (record: {
  responseBody: unknown;
  responseStatus: number;
}): Response => json(record.responseStatus, record.responseBody);

interface IdempotencyState {
  keyHash: string;
  replayed?: Response;
  requestHash: string;
  reserved: boolean;
}

const trackIdempotency = async (
  ctx: ActionCtx,
  endpoint: string,
  outcome: string,
  requestKey: string
) => {
  await ctx.runMutation(
    (internal as any).idempotencyAnalytics.trackIdempotencyOutcome,
    { endpoint, outcome, requestKey }
  );
};

const maybeHandleIdempotency = async (
  ctx: ActionCtx,
  args: {
    userId: string;
    method: "POST";
    path: string;
    requestBody: unknown;
    request: Request;
  }
): Promise<IdempotencyState | Response> => {
  const idempotencyKey = parseOptionalString(
    args.request.headers.get("idempotency-key")
  );
  if (!idempotencyKey) {
    await trackIdempotency(ctx, args.path, "skipped", crypto.randomUUID());
    return {
      keyHash: "",
      requestHash: "",
      reserved: false,
    };
  }

  const [keyHash, requestHash] = await Promise.all([
    sha256(`${args.userId}:${idempotencyKey}`),
    sha256(
      JSON.stringify({
        body: args.requestBody,
        method: args.method,
        path: args.path,
      })
    ),
  ]);

  const reservation = await ctx.runMutation(
    (internal as any).idempotency.beginIdempotencyRequestForUser,
    {
      keyHash,
      method: args.method,
      path: args.path,
      requestHash,
      userId: args.userId,
    }
  );

  switch (reservation.status) {
    case "started":
      await trackIdempotency(ctx, args.path, "started", keyHash);
      return { keyHash, requestHash, reserved: true };
    case "replay":
      await trackIdempotency(ctx, args.path, "replayed", keyHash);
      return {
        keyHash,
        requestHash,
        reserved: false,
        replayed: buildIdempotentResponse(reservation.record),
      };
    case "in_progress":
      await trackIdempotency(ctx, args.path, "in_progress", keyHash);
      return errorResponse(
        409,
        "CONFLICT",
        "Idempotency-Key is already being processed"
      );
    case "conflict":
      await trackIdempotency(ctx, args.path, "conflict", keyHash);
      return errorResponse(
        409,
        "CONFLICT",
        "Idempotency-Key was already used with a different request"
      );
    default:
      await trackIdempotency(ctx, args.path, "error", keyHash);
      return errorResponse(
        500,
        "INTERNAL_ERROR",
        "Failed to reserve Idempotency-Key"
      );
  }
};

const completeIdempotencyResponse = async (
  ctx: ActionCtx,
  args: {
    userId: string;
    keyHash: string;
    requestHash: string;
    responseBody: unknown;
    responseStatus: number;
  }
): Promise<void> => {
  if (!args.keyHash) {
    return;
  }

  await ctx.runMutation(
    (internal as any).idempotency.completeIdempotencyRequestForUser,
    {
      keyHash: args.keyHash,
      requestHash: args.requestHash,
      responseBody: args.responseBody,
      responseStatus: args.responseStatus,
      userId: args.userId,
    }
  );
};

const releaseIdempotencyResponse = async (
  ctx: ActionCtx,
  args: {
    userId: string;
    keyHash: string;
    requestHash: string;
  }
): Promise<void> => {
  if (!args.keyHash) {
    return;
  }

  await ctx.runMutation(
    (internal as any).idempotency.releaseIdempotencyRequestForUser,
    args
  );
};

// Throttle well-formed-but-invalid API keys via a single shared bucket so an
// attacker rotating random bearer tokens cannot mint a fresh limit per token.
// Returns a 429 Response when the shared bucket is exhausted, otherwise null.
const enforceInvalidAuthLimit = async (
  ctx: ActionCtx
): Promise<Response | null> => {
  let limit: { ok?: boolean; retryAt?: number } | null = null;
  try {
    limit = await ctx.runMutation(
      (internal as any).raycast.consumeInvalidApiAuthLimit,
      {}
    );
  } catch (error) {
    if (isRateLimitContentionError(error)) {
      return RATE_LIMIT_CONTENTION_ERROR();
    }
    // Never fail open on the invalid-auth path: surface a generic auth error.
    return AUTH_INTERNAL_ERROR();
  }

  if (!limit?.ok) {
    return RATE_LIMITED_ERROR(limit?.retryAt);
  }

  return null;
};

const withAuthorizedUser = async (
  ctx: ActionCtx,
  request: Request,
  options: { chargeRateLimit?: boolean; resource?: WorkosResource } = {}
): Promise<AuthResult> => {
  const chargeRateLimit = options.chargeRateLimit ?? true;
  const token = parseBearerToken(request);
  if (!token) {
    return {
      error: errorResponse(
        401,
        "UNAUTHORIZED",
        "Missing or invalid Authorization header"
      ),
    };
  }

  let primary: ReturnType<typeof readAuthPrimary>;
  try {
    primary = readAuthPrimary();
  } catch {
    return { error: AUTH_INTERNAL_ERROR() };
  }
  // Bearer credentials are discriminated before any DB read: `teakapi_` API keys and opaque
  // 32-char Better Auth tokens, or bounded WorkOS JWTs. This ensures
  // the cheapest abuse vector (spraying random tokens) is rejected without a
  // write, and so failures can return the right error code per credential type.
  const isApiKey = isWellFormedApiKey(token);
  const isOAuthToken =
    !isApiKey && primary === "betterauth" && isWellFormedOAuthToken(token);
  const isConnectToken =
    !isApiKey &&
    primary === "workos" &&
    token.length <= 16_384 &&
    token.split(".").length === 3;

  if (!(isApiKey || isOAuthToken || isConnectToken)) {
    const limited = await enforceInvalidAuthLimit(ctx);
    if (limited) {
      return { error: limited };
    }
    return {
      error: errorResponse(
        401,
        "INVALID_API_KEY",
        "Invalid or revoked API key"
      ),
    };
  }

  // Validate first. Both validators are effectively read-only on the hot path
  // (the API-key one only writes a throttled lastUsedAt), so doing it before
  // rate limiting lets us key the limiter on a stable identity instead of the
  // attacker-controlled raw token.
  let validated: AuthorizedUser | null = null;
  let credential: (Omit<AuthorizedUser, "userId"> & { userId: string }) | null =
    null;
  try {
    if (isConnectToken) {
      const issuer = env.WORKOS_AUTHKIT_DOMAIN;
      if (!issuer) {
        return { error: AUTH_INTERNAL_ERROR() };
      }
      const principal = await verifyWorkosConnectToken(token, {
        issuer,
        audience: WORKOS_RESOURCES[options.resource ?? "api"],
      });
      if (principal) {
        const owner = await ctx.runMutation(
          internal.workosConsents.authorizeConnectConsent,
          principal
        );
        if (owner.status === "ok") {
          validated = {
            userId: owner.teakUserId as import("./securitySessions").TeakUserId,
            access: "full_access",
            source: "oauth",
            keyId: principal.consentId,
            rateLimitKey: `workos:${principal.clientId}:${owner.teakUserId}`,
          };
        }
      }
    } else {
      credential = isApiKey
        ? await ctx.runMutation((internal as any).apiKeys.validateUserApiKey, {
            token,
          })
        : await ctx.runMutation(
            (internal as any).oauthTokens.validateOAuthAccessToken,
            { token }
          );
      if (credential) {
        const userId =
          primary === "workos"
            ? await resolveWorkosApiKeyOwner(ctx, credential.userId)
            : await resolveStoredUserId(ctx, credential.userId);
        if (userId) {
          validated = { ...credential, userId };
        }
      }
    }
  } catch {
    return { error: AUTH_INTERNAL_ERROR() };
  }

  if (!validated) {
    const limited = await enforceInvalidAuthLimit(ctx);
    if (limited) {
      return { error: limited };
    }
    return {
      error:
        isOAuthToken || isConnectToken
          ? errorResponse(
              401,
              "UNAUTHORIZED",
              "Invalid or expired access token"
            )
          : errorResponse(401, "INVALID_API_KEY", "Invalid or revoked API key"),
    };
  }

  if (!chargeRateLimit) {
    return { validated };
  }

  // Rate limit successful auth per validated identity, so the limit follows the
  // real key / OAuth app+user rather than whatever token string the caller sent.
  let rateLimit: { ok?: boolean; retryAt?: number } | null = null;
  try {
    rateLimit = await ctx.runMutation(
      (internal as any).raycast.checkApiRateLimit,
      {
        rateLimitKey: `key:${validated.rateLimitKey}`,
      }
    );
  } catch (error) {
    if (isRateLimitContentionError(error)) {
      return { error: RATE_LIMIT_CONTENTION_ERROR() };
    }
    return { error: AUTH_INTERNAL_ERROR() };
  }

  if (!rateLimit?.ok) {
    return { error: RATE_LIMITED_ERROR(rateLimit?.retryAt) };
  }

  return { validated };
};

const validatePublicApiBearer = async (
  ctx: ActionCtx,
  request: Request,
  resource: WorkosResource = "api"
): Promise<Response | null> => {
  const auth = await withAuthorizedUser(ctx, request, {
    chargeRateLimit: false,
    resource,
  });
  return "error" in auth ? auth.error : null;
};

export {
  completeIdempotencyResponse,
  type IdempotencyState,
  maybeHandleIdempotency,
  releaseIdempotencyResponse,
  trackIdempotency,
  validatePublicApiBearer,
  withAuthorizedUser,
};
