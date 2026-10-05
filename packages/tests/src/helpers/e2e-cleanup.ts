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
  emails?: string[],
  sleep: () => Promise<void> = () =>
    new Promise((resolve) => setTimeout(resolve, 1500))
): Promise<E2ECleanupResult> => {
  requireE2ECleanup();
  const deadline = Date.now() + 120_000;
  const deleted = new Set<string>(),
    alreadyDeleted = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let attempt = 0; attempt < 200 && Date.now() < deadline; attempt++) {
    const sweepBody = cursor ? { cursor } : {};
    const response = await fetch(
      `${env.convexSiteUrl}/api/auth/internal/e2e/cleanup`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.cleanupToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(emails ? { emails } : sweepBody),
        signal: AbortSignal.timeout(Math.min(15_000, deadline - Date.now())),
      }
    );
    const payload: unknown = await response.json().catch(() => null);
    if (!isE2ECleanupResult(payload)) {
      throw new Error(
        `Production E2E cleanup returned an invalid response (${response.status})`
      );
    }
    if (
      !response.ok ||
      payload.ignoredOutOfRange.length > 0 ||
      payload.failures.some(
        (failure) => failure.reason !== "account cleanup pending"
      ) ||
      (response.status !== 202 && payload.failures.length > 0)
    ) {
      throw new Error(
        `Production E2E cleanup failed (${response.status}): ${summarizeE2ECleanup(payload)}`
      );
    }
    for (const email of payload.deleted) {
      deleted.add(email);
    }
    for (const email of payload.alreadyDeleted) {
      alreadyDeleted.add(email);
    }
    if (deleted.size + alreadyDeleted.size > 200) {
      throw new Error("E2E cleanup candidate budget exceeded");
    }
    if (response.status === 202) {
      if (!payload.failures.length) {
        throw new Error("E2E cleanup pending without evidence");
      }
      await sleep();
      continue;
    }
    if (!payload.remainingEligible) {
      return {
        ...payload,
        deleted: [...deleted],
        alreadyDeleted: [...alreadyDeleted],
      };
    }
    const next = (payload as E2ECleanupResult & { nextCursor?: unknown })
      .nextCursor;
    if (
      emails ||
      typeof next !== "string" ||
      !next.length ||
      next.length > 8192 ||
      cursors.has(next)
    ) {
      throw new Error("Invalid or non-progressing E2E sweep cursor");
    }
    cursors.add(next);
    cursor = next;
  }
  throw new Error(
    "E2E cleanup deadline or page budget exceeded; cleanup remains unproven"
  );
};

const PROVISION_MAX_ATTEMPTS = 4;

const waitForProvisionRetry = (attempt: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** (attempt - 1)));

export const provisionE2EAccount = async (
  email: string,
  password: string,
  sleep: (attempt: number) => Promise<void> = waitForProvisionRetry
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
  let admittedPending = false;
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
      await sleep(attempt);
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
    if (
      response.status === 503 &&
      payload &&
      typeof payload === "object" &&
      (payload as { code?: unknown }).code === "E2E_PROVISION_PENDING"
    ) {
      admittedPending = true;
    }
    if (
      response.status === 409 &&
      (sawLostResponse ||
        (admittedPending &&
          payload &&
          typeof payload === "object" &&
          (payload as { email?: unknown }).email === email.toLowerCase()))
    ) {
      // The retried request raced an earlier attempt whose response was
      // lost: the account now exists, which is the goal of this helper.
      return;
    }
    if (
      (response.status >= 500 || response.status === 429) &&
      attempt < PROVISION_MAX_ATTEMPTS
    ) {
      await sleep(attempt);
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
