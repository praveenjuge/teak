/**
 * Auth monitoring signals for the WorkOS cutover rollback triggers.
 *
 * Every signal is a structured log line or an existing telemetry metric. None
 * carries an email, raw user ID, token, URL, request body or profile field;
 * WorkOS subjects are hashed here before anything is logged. Monitoring must
 * never change an authentication result, so every emitter swallows its own
 * failures and nothing here writes to the database.
 */

import { SIGNUPS_PAUSED_MESSAGE } from "./shared/constants";

const REASON_PATTERN = /[^a-z0-9_]+/gu;

export const normalizeMonitoringReason = (value: unknown): string => {
  if (typeof value !== "string") {
    return "unknown";
  }
  const reason = value
    .toLowerCase()
    .replace(REASON_PATTERN, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 48);
  return reason || "unknown";
};

// The same `s_` + 16 hex digest the private observer applies to WorkOS event
// user IDs, so denials and sign-ins correlate without either side logging IDs.
export const hashMonitoringSubject = async (
  subject: string
): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(subject)
  );
  const hex = Array.from(new Uint8Array(digest).slice(0, 8), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `s_${hex}`;
};

export type ResolverVerification =
  | { kind: "session"; emailVerified: boolean }
  | { kind: "connect" };

export const logResolverDenial = async (input: {
  reason: string;
  verification: ResolverVerification;
  workosUserId: string;
}): Promise<void> => {
  try {
    console.warn("identity_resolver_denial", {
      provider: "workos",
      reason: normalizeMonitoringReason(input.reason),
      verification: input.verification.kind,
      // The session claim the resolver was given; Connect tokens carry none.
      emailVerified:
        input.verification.kind === "session"
          ? input.verification.emailVerified === true
          : null,
      subject: await hashMonitoringSubject(input.workosUserId),
    });
  } catch {
    // Monitoring must never alter identity resolution.
  }
};

export type BearerCredentialClass =
  | "missing"
  | "api_key"
  | "betterauth_oauth"
  | "workos_connect"
  | "malformed";

export type PublicApiAuthReason =
  | "ok"
  | "missing_bearer"
  | "nonprimary_credential"
  | "malformed_credential"
  | "invalid_credential"
  | "owner_unresolved"
  | "expired_token"
  | "invalid_token"
  | "jwks_unavailable"
  | "issuer_unconfigured"
  | "rate_limited"
  | "invalid_auth_rate_limited"
  | "rate_limit_contention"
  | "primary_unreadable"
  | "internal_error"
  | `owner_${string}`;

export interface PublicApiAuthOutcome {
  // `gate` is the MCP transport check; `request` is the per-operation check.
  check: "gate" | "request";
  credential: BearerCredentialClass;
  primary: "betterauth" | "workos" | "unknown";
  reason: PublicApiAuthReason;
  status: number;
  surface: "rest" | "mcp";
}

export const logPublicApiAuthOutcome = (
  outcome: PublicApiAuthOutcome
): void => {
  try {
    console.log("public_api_auth_outcome", {
      surface: outcome.surface,
      check: outcome.check,
      status: outcome.status,
      credential: outcome.credential,
      reason: normalizeMonitoringReason(outcome.reason),
      primary: outcome.primary,
    });
  } catch {
    // Monitoring must never alter the API response.
  }
};

// Labels a Connect token the verifier has already rejected. The payload is not
// trusted for anything else; an unreadable token is simply not "expired".
export const isExpiredJwt = (token: string, nowMs = Date.now()): boolean => {
  try {
    const segment = token.split(".")[1] ?? "";
    const base64 = segment.replace(/-/gu, "+").replace(/_/gu, "/");
    const payload = JSON.parse(
      atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="))
    ) as { exp?: unknown };
    return typeof payload.exp === "number" && payload.exp * 1000 <= nowMs;
  } catch {
    return false;
  }
};

export interface BetterAuthSignInAttempt {
  method: "email" | "social";
  outcome: "success" | "failure";
  provider?: string;
  reason: string;
}

interface HookResult {
  body?: { code?: unknown; message?: unknown };
  headers?: { get?: (name: string) => string | null };
  statusCode?: unknown;
}

const asHookResult = (value: unknown): HookResult | null =>
  value instanceof Error && typeof (value as HookResult).statusCode === "number"
    ? (value as HookResult)
    : null;

const redirectError = (error: HookResult): string | null | undefined => {
  if (error.statusCode !== 302) {
    return;
  }
  try {
    const location = error.headers?.get?.("location");
    return location
      ? new URL(location, "https://x.invalid").searchParams.get("error")
      : null;
  } catch {
    return null;
  }
};

// The social providers createAuth registers. Other callback ids are not a
// sign-in for this deployment and must not mint metric dimensions.
const SOCIAL_PROVIDERS = new Set(["google", "apple"]);

// Social failures can carry a provider- or caller-supplied `error`, so only
// known Better Auth and OAuth codes survive; anything else is `other`.
const SOCIAL_FAILURE_REASONS = new Set([
  "access_denied",
  "account_not_linked",
  "email_not_found",
  "internal_server_error",
  "invalid_callback_request",
  "invalid_code",
  "invalid_request",
  "invalid_token",
  "no_callback_url",
  "no_code",
  "oauth_provider_not_found",
  "server_error",
  "state_generation_error",
  "state_invalid",
  "state_mismatch",
  "state_not_found",
  "temporarily_unavailable",
  "unable_to_create_session",
  "unable_to_get_user_info",
  "unable_to_link_account",
  "user_cancelled_authorize",
]);

// The account did not exist: a sign-up, not a sign-in. Better Auth reports
// these as `signup disabled`, a failed user creation, or the freeze message
// from guardUserCreation (as a redirect `error` or OAUTH_LINK_ERROR message).
const SIGN_UP_REASONS = new Set([
  "sign_up_disabled",
  "signup_disabled",
  "unable_to_create_user",
  normalizeMonitoringReason(SIGNUPS_PAUSED_MESSAGE),
]);

// Failures that only the explicit account-linking flow produces.
const LINK_ONLY_REASONS = new Set([
  "account_already_linked_to_different_user",
  "email_doesn_t_match",
]);

const NEW_USER_WINDOW_MS = 60_000;

const isNewUserSession = (session: unknown): boolean => {
  const value = session as {
    session?: { createdAt?: unknown };
    user?: { createdAt?: unknown };
  };
  const userCreated = new Date(value?.user?.createdAt as string).getTime();
  const sessionCreated = new Date(
    value?.session?.createdAt as string
  ).getTime();
  return (
    Number.isFinite(userCreated) &&
    Number.isFinite(sessionCreated) &&
    sessionCreated - userCreated < NEW_USER_WINDOW_MS
  );
};

const socialFailureReason = (error: HookResult): string | null => {
  const redirected = redirectError(error);
  if (redirected === null) {
    // A redirect without `error`: account linking or a provider bounce.
    return null;
  }
  // The native id-token path wraps user-creation errors in OAUTH_LINK_ERROR.
  const raw =
    redirected ??
    (error.body?.code === "OAUTH_LINK_ERROR"
      ? error.body.message
      : error.body?.code) ??
    "error";
  return normalizeMonitoringReason(raw);
};

/**
 * One Better Auth sign-in attempt, or null when the request is not a sign-in
 * outcome: refreshes, sign-ups (including frozen ones), sign-outs, account
 * linking, the redirect that starts a social sign-in, Apple's form-post bounce
 * and callbacks for providers this deployment does not register.
 */
export const classifyBetterAuthSignIn = (input: {
  httpMethod?: string;
  newSession: unknown;
  path: string | undefined;
  providerId?: unknown;
  returned: unknown;
}): BetterAuthSignInAttempt | null => {
  const error = asHookResult(input.returned);
  const hasSession = Boolean(input.newSession);
  if (input.path === "/sign-in/email") {
    if (hasSession) {
      return { method: "email", outcome: "success", reason: "ok" };
    }
    return {
      method: "email",
      outcome: "failure",
      reason: error
        ? normalizeMonitoringReason(error.body?.code ?? "error")
        : "no_session",
    };
  }
  if (input.path !== "/sign-in/social" && input.path !== "/callback/:id") {
    return null;
  }
  // Apple posts its result, which Better Auth re-issues as a GET; only the
  // GET is the outcome, so each attempt counts once.
  if (input.path === "/callback/:id" && input.httpMethod === "POST") {
    return null;
  }
  if (
    typeof input.providerId !== "string" ||
    !SOCIAL_PROVIDERS.has(input.providerId)
  ) {
    return null;
  }
  const provider = input.providerId;
  if (hasSession) {
    return isNewUserSession(input.newSession)
      ? null
      : { method: "social", outcome: "success", provider, reason: "ok" };
  }
  if (!error) {
    return null;
  }
  const reason = socialFailureReason(error);
  if (
    reason === null ||
    SIGN_UP_REASONS.has(reason) ||
    LINK_ONLY_REASONS.has(reason)
  ) {
    return null;
  }
  return {
    method: "social",
    outcome: "failure",
    provider,
    reason: SOCIAL_FAILURE_REASONS.has(reason) ? reason : "other",
  };
};
