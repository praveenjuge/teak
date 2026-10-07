/**
 * Auth monitoring signals for the WorkOS cutover rollback triggers.
 *
 * Every signal is a structured log line or an existing telemetry metric. None
 * carries an email, raw user ID, token, URL, request body or profile field;
 * WorkOS subjects are hashed here before anything is logged. Monitoring must
 * never change an authentication result, so every emitter swallows its own
 * failures and nothing here writes to the database.
 */

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
  body?: { code?: unknown };
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

// Better Auth reports frozen social sign-ups through the sign-in callback.
const SIGN_UP_REASONS = new Set(["sign_up_disabled", "signup_disabled"]);
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

/**
 * One Better Auth sign-in attempt, or null when the request is not a sign-in
 * outcome: refreshes, sign-ups, sign-outs, account linking, the redirect that
 * starts a social sign-in and Apple's form-post bounce all return null.
 */
export const classifyBetterAuthSignIn = (input: {
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
  const provider =
    typeof input.providerId === "string" &&
    /^[a-z0-9-]{1,32}$/u.test(input.providerId)
      ? input.providerId
      : undefined;
  if (hasSession) {
    return isNewUserSession(input.newSession)
      ? null
      : { method: "social", outcome: "success", provider, reason: "ok" };
  }
  if (!error) {
    return null;
  }
  const redirected = redirectError(error);
  if (redirected === null) {
    return null;
  }
  const reason = normalizeMonitoringReason(
    redirected ?? error.body?.code ?? "error"
  );
  return SIGN_UP_REASONS.has(reason)
    ? null
    : { method: "social", outcome: "failure", provider, reason };
};
