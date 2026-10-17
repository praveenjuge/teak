import {
  ignoreTelemetryError,
  ignoreTelemetryErrorAsync,
} from "./shared/telemetry";
import { sha256Hex } from "./storage/r2Keys";

// No signal carries an email, raw user ID, token, URL, request body or
// profile field; WorkOS subjects are hashed here before anything is logged.

const REASON_PATTERN = /[^a-z0-9_]+/gu;

const normalizeMonitoringReason = (value: unknown): string => {
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

export const hashMonitoringSubject = async (
  subject: string
): Promise<string> => {
  // The first 8 bytes of the digest.
  const hex = (await sha256Hex(subject)).slice(0, 16);
  return `s_${hex}`;
};

export type ResolverVerification =
  | { kind: "session"; emailVerified: boolean }
  | { kind: "connect" };

export const logResolverDenial = async (input: {
  reason: string;
  verification: ResolverVerification;
  workosUserId: string;
}): Promise<void> =>
  ignoreTelemetryErrorAsync(async () => {
    console.warn("identity_resolver_denial", {
      provider: "workos",
      reason: normalizeMonitoringReason(input.reason),
      verification: input.verification.kind,
      emailVerified:
        input.verification.kind === "session"
          ? input.verification.emailVerified === true
          : null,
      subject: await hashMonitoringSubject(input.workosUserId),
    });
  });

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
  | "expired_token"
  | "invalid_token"
  | "jwks_unavailable"
  | "issuer_unconfigured"
  | "resource_unconfigured"
  | "rate_limited"
  | "invalid_auth_rate_limited"
  | "rate_limit_contention"
  | "internal_error"
  | `owner_${string}`;

export interface PublicApiAuthOutcome {
  check: "gate" | "request";
  credential: BearerCredentialClass;
  reason: PublicApiAuthReason;
  status: number;
  surface: "rest" | "mcp";
}

export const logPublicApiAuthOutcome = (outcome: PublicApiAuthOutcome): void =>
  ignoreTelemetryError(() => {
    console.log("public_api_auth_outcome", {
      surface: outcome.surface,
      check: outcome.check,
      status: outcome.status,
      credential: outcome.credential,
      reason: normalizeMonitoringReason(outcome.reason),
    });
  });

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
