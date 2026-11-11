import { internal } from "../../_generated/api";
import type { ActionCtx } from "../../_generated/server";
import {
  logPublicApiAuthOutcome,
  type PublicApiAuthReason,
} from "../../authMonitoring";
import {
  isOptimisticConcurrencyError,
  isRateLimitContentionError,
} from "../../convexFailures";
import { edgeRateLimitCharge } from "../../edgeIdentity";
import { findWorkosConnectIssuer, findWorkosResources } from "../../env";
import { workosRateLimitKey } from "../../rateLimiter";
import type { TeakUserId } from "../../securitySessions";
import { bearerCredentialKind, parseBearer } from "../../shared/bearer";
import { RATE_LIMIT_CONFIG } from "../../shared/rateLimits";
import {
  verifyWorkosConnectTokenSignature,
  type WorkosConnectPrincipal,
  type WorkosResource,
} from "../../workos/tokens";
import {
  type ConsentAuthorization,
  isConsentSeenRecently,
} from "../../workosConsents";
import {
  AUTH_INTERNAL_ERROR,
  type AuthorizedUser,
  type AuthResult,
  errorResponse,
  RATE_LIMIT_CONTENTION_ERROR,
  RATE_LIMITED_ERROR,
  SERVICE_BUSY_ERROR,
} from "./shared";

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

// A limit or credential check that threw: contention on the rate limiter or
// another write conflict passes in a moment; anything else is ours.
const decideFromLimitError = (error: unknown): Decision => {
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
};

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
    return decideFromLimitError(error);
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

const bearerOf = (request: Request): string | null =>
  parseBearer(request.headers.get("authorization"));

const recordAuthOutcome = (
  request: Request,
  options: AuthOptions,
  reason: PublicApiAuthReason,
  status: number
): void => {
  logPublicApiAuthOutcome({
    check: options.chargeRateLimit === false ? "gate" : "request",
    credential: bearerCredentialKind(bearerOf(request)),
    reason,
    status,
    surface: options.resource === "mcp" ? "mcp" : "rest",
  });
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

// A request charged elsewhere (by the Core Worker, or the MCP transport gate)
// for a consent seen in the last few minutes writes nothing, so it only
// reads. Inserting a new consent, refreshing `lastSeenAt` and charging the
// rate limit go through the mutation, which rechecks everything in its own
// transaction.
const authorizeConnectConsent = async (
  ctx: ActionCtx,
  principal: WorkosConnectPrincipal,
  chargeRateLimit: boolean
): Promise<ConsentAuthorization> => {
  if (!chargeRateLimit) {
    const consent = await ctx.runQuery(
      internal.workosConsents.readConnectConsent,
      principal
    );
    if (consent.status === "denied") {
      return consent;
    }
    if (isConsentSeenRecently(consent.lastSeenAt)) {
      return { status: "ok", teakUserId: consent.teakUserId };
    }
  }
  return await ctx.runMutation(
    internal.workosConsents.authorizeConnectConsent,
    { ...principal, chargeRateLimit }
  );
};

// A token's API key, read-only when it validated recently and nothing has to
// be charged here; else the mutation that validates (and charges) it.
const validateApiKey = async (
  ctx: ActionCtx,
  token: string,
  chargeRateLimit: boolean
) =>
  (!chargeRateLimit &&
    (await ctx.runQuery(internal.apiKeys.readValidatedApiKey, { token }))) ||
  (await ctx.runMutation(internal.apiKeys.validateUserApiKey, {
    token,
    chargeRateLimit,
  }));

const authorizeBearer = async (
  ctx: ActionCtx,
  request: Request,
  options: AuthOptions
): Promise<Decision> => {
  // The Core Worker attests a request it has charged, and to which limit. An
  // owner charge covers `publicApiRequests`; any charge covers the shared
  // invalid-credential bucket. A credential the edge didn't know may still be
  // valid, so its owner's limit is charged here as usual.
  const edgeCharge = await edgeRateLimitCharge(request);
  const edgeCharged = edgeCharge !== null;
  const chargeRateLimit =
    (options.chargeRateLimit ?? true) && edgeCharge !== "owner";
  const token = bearerOf(request);
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

  const credentialKind = bearerCredentialKind(token);
  const isConnectToken = credentialKind === "workos_connect";

  if (credentialKind === "malformed") {
    const limited = edgeCharged ? null : await enforceInvalidAuthLimit(ctx);
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
      "malformed_credential"
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
      const principal = await verifyWorkosConnectTokenSignature(token, {
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
        const owner = await authorizeConnectConsent(
          ctx,
          principal,
          chargeRateLimit
        );
        if (owner.status === "ok") {
          rateLimit = owner.rateLimit;
          validated = {
            userId: owner.teakUserId as TeakUserId,
            access: "full_access",
            clientId: principal.clientId,
            source: "oauth",
            keyId: principal.consentId,
            rateLimitKey: workosRateLimitKey(
              principal.clientId,
              owner.teakUserId
            ),
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
      const credential = await validateApiKey(ctx, token, chargeRateLimit);
      if (credential) {
        const { rateLimit: charged, ...key } = credential;
        rateLimit = charged;
        validated = { ...key, userId: key.userId as TeakUserId };
      }
    }
  } catch (error) {
    return decideFromLimitError(error);
  }

  if (!validated) {
    // The shared invalid-auth bucket throttles credentials anyone can make up.
    // A token the issuer really signed (one that has only expired, or whose
    // consent was withdrawn) always answers 401, so its client refreshes or
    // signs in again instead of getting 429 while someone else floods the
    // bucket with junk.
    const issuerSigned =
      rejection === "expired_token" || rejection.startsWith("owner_");
    const limited =
      issuerSigned || edgeCharged ? null : await enforceInvalidAuthLimit(ctx);
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

/**
 * The MCP endpoint's one check of a request's bearer. Its tool calls run as
 * the user it returns; `chargeEachCall` says whether each must still be
 * charged against the owner's limit, because the Core Worker didn't charge
 * the request (a direct call, or a JSON-RPC batch).
 */
const authorizeMcpRequest = async (
  ctx: ActionCtx,
  request: Request
): Promise<
  { error: Response } | { chargeEachCall: boolean; validated: AuthorizedUser }
> => {
  const auth = await withAuthorizedUser(ctx, request, {
    chargeRateLimit: false,
    resource: "mcp",
  });
  if ("error" in auth) {
    return auth;
  }
  return {
    validated: auth.validated,
    chargeEachCall: (await edgeRateLimitCharge(request)) !== "owner",
  };
};

const refuseCall = async (
  ctx: ActionCtx,
  validated: AuthorizedUser
): Promise<Decision | null> => {
  let limit: { ok: boolean; retryAt?: number };
  try {
    limit = await ctx.runMutation(internal.publicApi.chargeApiRequest, {
      rateLimitKey: validated.rateLimitKey,
    });
  } catch (error) {
    return decideFromLimitError(error);
  }
  return limit.ok
    ? null
    : decide(
        {
          error: RATE_LIMITED_ERROR(
            limit.retryAt,
            RATE_LIMIT_CONFIG.publicApiRequests.capacity
          ),
        },
        "rate_limited"
      );
};

/**
 * Charges one call by an already authorized user; a Response refuses it,
 * and is logged as that call's auth outcome like any other refusal.
 */
const chargeAuthorizedCall = async (
  ctx: ActionCtx,
  request: Request,
  validated: AuthorizedUser
): Promise<Response | null> => {
  const refused = await refuseCall(ctx, validated);
  if (!refused) {
    return null;
  }
  if ("error" in refused.result) {
    recordAuthOutcome(
      request,
      { resource: "mcp" },
      refused.reason,
      refused.result.error.status
    );
    return refused.result.error;
  }
  return null;
};

export { authorizeMcpRequest, chargeAuthorizedCall, withAuthorizedUser };
