import { env, requireE2ECleanup, requireE2ENamespace } from "./env";

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

const PROVISION_MAX_ATTEMPTS = 4;

const waitForProvisionRetry = (attempt: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** (attempt - 1)));

export const provisionE2EAccount = async (
  email: string,
  password: string
): Promise<void> => {
  requireE2ECleanup();
  requireE2ENamespace();
  if (!isConfiguredE2EEmail(email)) {
    throw new Error("Production E2E provisioning email is invalid");
  }
  const requestInit: RequestInit = {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.cleanupToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  };
  // Only a network-level failure is ambiguous: the request may have
  // reached the server while its response was lost. An explicit error
  // status means the server rejected the request, so it cannot prove the
  // account was created.
  let sawLostResponse = false;
  for (let attempt = 1; attempt <= PROVISION_MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(
        `${env.convexSiteUrl}/api/auth/internal/e2e/provision`,
        requestInit
      );
    } catch (error) {
      sawLostResponse = true;
      if (attempt === PROVISION_MAX_ATTEMPTS) {
        throw new Error(
          `Production E2E provisioning failed (network): ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
      await waitForProvisionRetry(attempt);
      continue;
    }
    const payload: unknown = await response.json().catch(() => null);
    if (
      response.ok &&
      payload &&
      typeof payload === "object" &&
      (payload as { email?: unknown }).email === email.toLowerCase()
    ) {
      return;
    }
    if (response.status === 409 && sawLostResponse) {
      // The retried request raced an earlier attempt whose response was
      // lost: the account now exists, which is the goal of this helper.
      return;
    }
    if (
      (response.status >= 500 || response.status === 429) &&
      attempt < PROVISION_MAX_ATTEMPTS
    ) {
      await waitForProvisionRetry(attempt);
      continue;
    }
    throw new Error(`Production E2E provisioning failed (${response.status})`);
  }
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

export const assertE2EProvisioningReady = async (): Promise<void> => {
  const email = `e2e-preflight-${Date.now()}-provision@${env.emailDomain}`;
  await provisionE2EAccount(email, env.password);
  let cleanupConfirmed = false;
  try {
    const result = await cleanupE2EAccounts([email]);
    cleanupConfirmed =
      result.deleted.includes(email) || result.alreadyDeleted.includes(email);
    if (!cleanupConfirmed) {
      throw new Error("Production E2E provisioning preflight did not clean up");
    }
  } finally {
    if (!cleanupConfirmed) {
      await cleanupE2EAccounts([email]).catch(() => undefined);
    }
  }
};
