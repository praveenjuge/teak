import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import {
  type BearerCredentialClass,
  logPublicApiAuthOutcome,
  type PublicApiAuthReason,
} from "./authMonitoring";
import { hasEdgeRateLimitAttestation } from "./edgeIdentity";
import { findWorkosConnectIssuer, findWorkosResources } from "./env";
import {
  AUTH_INTERNAL_ERROR,
  type AuthorizedUser,
  type AuthResult,
  errorResponse,
  isOptimisticConcurrencyError,
  isRateLimitContentionError,
  json,
  parseBearerToken,
  parseOptionalString,
  RATE_LIMIT_CONTENTION_ERROR,
  RATE_LIMITED_ERROR,
  SERVICE_BUSY_ERROR,
} from "./publicApiHttpShared";
import type { TeakUserId } from "./securitySessions";
import { isWellFormedApiKey } from "./shared/apiKeyFormat";
import { RATE_LIMIT_CONFIG } from "./shared/rateLimits";
import { ignoreTelemetryError } from "./shared/telemetry";
import { sha256Hex } from "./storage/r2Keys";
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
    return {
      keyHash: "",
      requestHash: "",
      reserved: false,
    };
  }

  const [keyHash, requestHash] = await Promise.all([
    sha256Hex(`${args.userId}:${idempotencyKey}`),
    sha256Hex(
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

const IDEMPOTENCY_COMPLETE_RETRY_DELAYS_MS = [50, 250];
const IDEMPOTENCY_COMPLETE_FALLBACK_DELAY_MS = 1000;

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

  const completion = {
    keyHash: args.keyHash,
    requestHash: args.requestHash,
    responseBody: args.responseBody,
    responseStatus: args.responseStatus,
    userId: args.userId,
  };
  const reference = (internal as any).idempotency
    .completeIdempotencyRequestForUser;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await ctx.runMutation(reference, completion);
      return;
    } catch (error) {
      const delay = IDEMPOTENCY_COMPLETE_RETRY_DELAYS_MS[attempt];
      if (delay === undefined) {
        console.error("[idempotency] Completion failed; scheduling retry", {
          error,
          keyHash: args.keyHash,
        });
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  try {
    await ctx.scheduler.runAfter(
      IDEMPOTENCY_COMPLETE_FALLBACK_DELAY_MS,
      reference,
      completion
    );
  } catch (error) {
    console.error("[idempotency] Could not schedule completion", {
      error,
      keyHash: args.keyHash,
    });
  }
};

const releaseReservationKeepingOriginalError = async (
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

  try {
    await ctx.runMutation(
      (internal as any).idempotency.releaseIdempotencyRequestForUser,
      args
    );
  } catch {}
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
    return decide({ error: AUTH_INTERNAL_ERROR() }, "internal_error");
  }

  if (!limit?.ok) {
    return decide(
      {
        error: RATE_LIMITED_ERROR(
          limit?.retryAt,
          RATE_LIMIT_CONFIG.invalidApiAuth.capacity
        ),
      },
      "invalid_auth_rate_limited"
    );
  }

  return null;
};

const classifyBearerCredential = (
  token: string | null
): BearerCredentialClass => {
  if (!token) {
    return "missing";
  }
  if (isWellFormedApiKey(token)) {
    return "api_key";
  }
  if (/^[A-Za-z0-9]{32}$/.test(token)) {
    return "betterauth_oauth";
  }
  return token.length <= 16_384 && token.split(".").length === 3
    ? "workos_connect"
    : "malformed";
};

const recordAuthOutcome = (
  request: Request,
  options: AuthOptions,
  reason: PublicApiAuthReason,
  status: number
): void =>
  ignoreTelemetryError(() => {
    logPublicApiAuthOutcome({
      check: options.chargeRateLimit === false ? "gate" : "request",
      credential: classifyBearerCredential(parseBearerToken(request)),
      reason,
      status,
      surface: options.resource === "mcp" ? "mcp" : "rest",
    });
  });

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
  const chargeRateLimit =
    (options.chargeRateLimit ?? true) &&
    !(await hasEdgeRateLimitAttestation(request));
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

  let validated: AuthorizedUser | null = null;
  let rateLimit: { ok?: boolean; retryAt?: number } | undefined;
  let rejection: PublicApiAuthReason = "invalid_credential";
  try {
    if (isConnectToken) {
      const issuer = findWorkosConnectIssuer();
      if (!issuer) {
        return decide({ error: AUTH_INTERNAL_ERROR() }, "issuer_unconfigured");
      }
      const resources = findWorkosResources();
      if (!resources) {
        return decide(
          { error: AUTH_INTERNAL_ERROR() },
          "resource_unconfigured"
        );
      }
      let jwksUnavailable = false;
      let tokenExpired = false;
      const principal = await verifyWorkosConnectToken(token, {
        issuer,
        audience: resources[options.resource ?? "api"],
        onExpired: () => {
          tokenExpired = true;
        },
        onUnavailable: () => {
          jwksUnavailable = true;
        },
      });
      if (principal) {
        const owner = await ctx.runMutation(
          internal.workosConsents.authorizeConnectConsent,
          { ...principal, chargeRateLimit }
        );
        if (owner.status === "ok") {
          rateLimit = owner.rateLimit;
          validated = {
            userId: owner.teakUserId as TeakUserId,
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
        rejection = tokenExpired ? "expired_token" : "invalid_token";
      }
    } else {
      const credential = await ctx.runMutation(
        (internal as any).apiKeys.validateUserApiKey,
        { token, chargeRateLimit }
      );
      if (credential) {
        const { rateLimit: charged, ...key } = credential;
        rateLimit = charged;
        validated = { ...key, userId: key.userId as TeakUserId };
      }
    }
  } catch (error) {
    if (isRateLimitContentionError(error)) {
      return decide(
        { error: RATE_LIMIT_CONTENTION_ERROR() },
        "rate_limit_contention"
      );
    }
    if (isOptimisticConcurrencyError(error)) {
      return decide({ error: SERVICE_BUSY_ERROR() }, "rate_limit_contention");
    }
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

  if (!rateLimit?.ok) {
    return decide(
      {
        error: RATE_LIMITED_ERROR(
          rateLimit?.retryAt,
          RATE_LIMIT_CONFIG.publicApiRequests.capacity
        ),
      },
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
  releaseReservationKeepingOriginalError,
  trackIdempotency,
  validatePublicApiBearer,
  withAuthorizedUser,
};
