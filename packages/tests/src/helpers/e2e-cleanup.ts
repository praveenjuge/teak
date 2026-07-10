import { env, requireE2ECleanup } from "./env";

export interface E2ECleanupResult {
  alreadyDeleted: string[];
  deleted: string[];
  failures: Array<{ email: string; reason: string }>;
  ignoredOutOfRange: string[];
  remainingEligible: boolean;
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

export const isE2ECleanupResult = (
  value: unknown
): value is E2ECleanupResult => {
  if (!(value && typeof value === "object")) {
    return false;
  }
  const candidate = value as Partial<E2ECleanupResult>;
  return (
    isStringArray(candidate.alreadyDeleted) &&
    isStringArray(candidate.deleted) &&
    Array.isArray(candidate.failures) &&
    candidate.failures.every(
      (failure) =>
        failure &&
        typeof failure.email === "string" &&
        typeof failure.reason === "string"
    ) &&
    isStringArray(candidate.ignoredOutOfRange) &&
    typeof candidate.remainingEligible === "boolean"
  );
};

export const summarizeE2ECleanup = (result: E2ECleanupResult): string =>
  [
    `deleted=${result.deleted.length}`,
    `alreadyDeleted=${result.alreadyDeleted.length}`,
    `failed=${result.failures.length}`,
    `outOfRange=${result.ignoredOutOfRange.length}`,
    `remaining=${result.remainingEligible}`,
  ].join(" ");

export const isConfiguredE2EEmail = (
  email: string,
  domain = env.emailDomain
): boolean => {
  const normalized = email.toLowerCase();
  const suffix = `@${domain.toLowerCase()}`;
  if (!normalized.endsWith(suffix)) {
    return false;
  }
  return /^e2e-[a-z0-9][a-z0-9-]{0,100}$/.test(
    normalized.slice(0, -suffix.length)
  );
};

export const cleanupE2EAccounts = async (
  emails?: string[]
): Promise<E2ECleanupResult> => {
  requireE2ECleanup();
  const response = await fetch(
    `${env.convexSiteUrl}/api/auth/internal/e2e/cleanup`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.cleanupToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(emails ? { emails } : {}),
    }
  );
  const payload: unknown = await response.json().catch(() => null);
  if (!isE2ECleanupResult(payload)) {
    throw new Error(
      `Production E2E cleanup returned an invalid response (${response.status})`
    );
  }
  const result = payload;
  if (!response.ok) {
    throw new Error(
      `Production E2E cleanup failed (${response.status}): ${summarizeE2ECleanup(result)}`
    );
  }
  return result;
};

export const assertE2ECleanupReady = async (): Promise<void> => {
  const email = `e2e-preflight-${Date.now()}-probe@${env.emailDomain}`;
  const result = await cleanupE2EAccounts([email]);
  if (!result.alreadyDeleted.includes(email)) {
    throw new Error(
      "Production E2E cleanup preflight was not side-effect free"
    );
  }
};
