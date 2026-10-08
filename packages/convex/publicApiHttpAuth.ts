/**
 * Public API authentication: bearer validation (API keys + OAuth tokens),
 * per-identity rate limiting, and idempotency-key reservation/replay.
 * Split out of `publicApiHttp.ts`, kept behavior-identical.
 */
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import {
  type BearerCredentialClass,
  isExpiredJwt,
  logPublicApiAuthOutcome,
  type PublicApiAuthReason,
} from "./authMonitoring";
import { findWorkosConnectIssuer } from "./env";
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
import { resolveStoredUserId } from "./securitySessions";
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

interface AuthOptions {
  chargeRateLimit?: boolean;
  resource?: WorkosResource;
}
interface Decision {
  reason: PublicApiAuthReason;
  result: AuthResult;
}

const decide = (result: AuthResult, reason: PublicApiAuthReason): Decision => ({
  result,
  reason,
});

// Throttle well-formed-but-invalid API keys via a single shared bucket so an
// attacker rotating random bearer tokens cannot mint a fresh limit per token.
// Returns a 429 decision when the shared bucket is exhausted, otherwise null.
const enforceInvalidAuthLimit = async (
  ctx: ActionCtx
): Promise<Decision | null> => {
  let limit: { ok?: boolean; retryAt?: number } | null = null;
  try {
    limit = await ctx.runMutation(
      internal.publicApi.consumeInvalidApiAuthLimit,
      {}
    );
  } catch (error) {
    if (isRateLimitContentionError(error)) {
      return decide(
        { error: RATE_LIMIT_CONTENTION_ERROR() },
        "rate_limit_contention"
      );
    }
    // Never fail open on the invalid-auth path: surface a generic auth error.
    return decide({ error: AUTH_INTERNAL_ERROR() }, "internal_error");
  }

  if (!limit?.ok) {
    return decide(
      { error: RATE_LIMITED_ERROR(limit?.retryAt) },
      "invalid_auth_rate_limited"
    );
  }

  return null;
};

// The same shape checks the boundary uses below, independent of the primary,
// so a credential from the other auth system (an old build) is visible.
const classifyBearerCredential = (
  token: string | null
): BearerCredentialClass => {
  if (!token) {
    return "missing";
  }
  if (isWellFormedApiKey(token)) {
    return "api_key";
  }
  // Retired Better Auth access tokens: opaque 32 characters. Still classified
  // so monitoring shows old clients that keep sending them.
  if (/^[A-Za-z0-9]{32}$/.test(token)) {
    return "betterauth_oauth";
  }
  return token.length <= 16_384 && token.split(".").length === 3
    ? "workos_connect"
    : "malformed";
};

// One log line per boundary decision. It never touches the response.
const recordAuthOutcome = (
  request: Request,
  options: AuthOptions,
  reason: PublicApiAuthReason,
  status: number
): void => {
  try {
    logPublicApiAuthOutcome({
      check: options.chargeRateLimit === false ? "gate" : "request",
      credential: classifyBearerCredential(parseBearerToken(request)),
      reason,
      status,
      surface: options.resource === "mcp" ? "mcp" : "rest",
    });
  } catch {
    // Monitoring must never alter authentication.
  }
};

const withAuthorizedUser = async (
  ctx: ActionCtx,
  request: Request,
  options: AuthOptions = {}
): Promise<AuthResult> => {
  let decision: Decision;
  try {
    decision = await authorizeBearer(ctx, request, options);
  } catch (error) {
    recordAuthOutcome(request, options, "internal_error", 500);
    throw error;
  }
  recordAuthOutcome(
    request,
    options,
    decision.reason,
    "error" in decision.result ? decision.result.error.status : 200
  );
  return decision.result;
};

const authorizeBearer = async (
  ctx: ActionCtx,
  request: Request,
  options: AuthOptions
): Promise<Decision> => {
  const chargeRateLimit = options.chargeRateLimit ?? true;
  const token = parseBearerToken(request);
  if (!token) {
    return decide(
      {
        error: errorResponse(
          401,
          "UNAUTHORIZED",
          "Missing or invalid Authorization header"
        ),
      },
      "missing_bearer"
    );
  }

  // Bearer credentials are discriminated before any DB read: `teakapi_` API
  // keys or bounded WorkOS JWTs. This ensures the cheapest abuse vector
  // (spraying random tokens) is rejected without a write, and so failures can
  // return the right error code per credential type.
  const isApiKey = isWellFormedApiKey(token);
  const isConnectToken =
    !isApiKey && token.length <= 16_384 && token.split(".").length === 3;

  if (!(isApiKey || isConnectToken)) {
    const limited = await enforceInvalidAuthLimit(ctx);
    if (limited) {
      return limited;
    }
    return decide(
      {
        error: errorResponse(
          401,
          "INVALID_API_KEY",
          "Invalid or revoked API key"
        ),
      },
      classifyBearerCredential(token) === "malformed"
        ? "malformed_credential"
        : "nonprimary_credential"
    );
  }

  // Validate first. Both validators are effectively read-only on the hot path
  // (the API-key one only writes a throttled lastUsedAt), so doing it before
  // rate limiting lets us key the limiter on a stable identity instead of the
  // attacker-controlled raw token.
  let validated: AuthorizedUser | null = null;
  let credential: (Omit<AuthorizedUser, "userId"> & { userId: string }) | null =
    null;
  let rejection: PublicApiAuthReason = "invalid_credential";
  try {
    if (isConnectToken) {
      const issuer = findWorkosConnectIssuer();
      if (!issuer) {
        return decide({ error: AUTH_INTERNAL_ERROR() }, "issuer_unconfigured");
      }
      let jwksUnavailable = false;
      const principal = await verifyWorkosConnectToken(token, {
        issuer,
        audience: WORKOS_RESOURCES[options.resource ?? "api"],
        onUnavailable: () => {
          jwksUnavailable = true;
        },
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
        } else {
          rejection = `owner_${owner.reason}`;
        }
      } else if (jwksUnavailable) {
        rejection = "jwks_unavailable";
      } else {
        rejection = isExpiredJwt(token) ? "expired_token" : "invalid_token";
      }
    } else {
      credential = await ctx.runMutation(
        (internal as any).apiKeys.validateUserApiKey,
        { token }
      );
      if (credential) {
        const userId = await resolveStoredUserId(ctx, credential.userId);
        if (userId) {
          validated = { ...credential, userId };
        } else {
          rejection = "owner_unresolved";
        }
      }
    }
  } catch {
    return decide({ error: AUTH_INTERNAL_ERROR() }, "internal_error");
  }

  if (!validated) {
    const limited = await enforceInvalidAuthLimit(ctx);
    if (limited) {
      return limited;
    }
    return decide(
      {
        error: isConnectToken
          ? errorResponse(
              401,
              "UNAUTHORIZED",
              "Invalid or expired access token"
            )
          : errorResponse(401, "INVALID_API_KEY", "Invalid or revoked API key"),
      },
      rejection
    );
  }

  if (!chargeRateLimit) {
    return decide({ validated }, "ok");
  }

  // Rate limit successful auth per validated identity, so the limit follows the
  // real key / OAuth app+user rather than whatever token string the caller sent.
  let rateLimit: { ok?: boolean; retryAt?: number } | null = null;
  try {
    rateLimit = await ctx.runMutation(internal.publicApi.checkApiRateLimit, {
      rateLimitKey: `key:${validated.rateLimitKey}`,
    });
  } catch (error) {
    if (isRateLimitContentionError(error)) {
      return decide(
        { error: RATE_LIMIT_CONTENTION_ERROR() },
        "rate_limit_contention"
      );
    }
    return decide({ error: AUTH_INTERNAL_ERROR() }, "internal_error");
  }

  if (!rateLimit?.ok) {
    return decide(
      { error: RATE_LIMITED_ERROR(rateLimit?.retryAt) },
      "rate_limited"
    );
  }

  return decide({ validated }, "ok");
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
  classifyBearerCredential,
  completeIdempotencyResponse,
  type IdempotencyState,
  maybeHandleIdempotency,
  releaseIdempotencyResponse,
  trackIdempotency,
  validatePublicApiBearer,
  withAuthorizedUser,
};
