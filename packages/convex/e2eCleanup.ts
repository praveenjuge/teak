import type { AuthContext } from "@better-auth/core";
import type { GenericCtx } from "@convex-dev/better-auth";
import { requireActionCtx } from "@convex-dev/better-auth/utils";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { z } from "zod";
import { internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";

const CLEANUP_CONCURRENCY = 3;
const EXACT_EMAIL_LIMIT = 20;
const MAX_CANDIDATES_PER_RUN = 200;
const ORPHAN_MIN_AGE_MS = 30 * 60 * 1000;
const ORPHAN_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const EXACT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

interface CleanupCandidate {
  createdAt: Date | number;
  email: string;
  id: string;
}

interface CleanupFailure {
  email: string;
  reason: string;
}

type CleanupAuthContext = Pick<AuthContext, "internalAdapter">;

export interface E2ECleanupResult {
  alreadyDeleted: string[];
  deleted: string[];
  failures: CleanupFailure[];
  ignoredOutOfRange: string[];
  remainingEligible: boolean;
}

const requestSchema = z.object({
  emails: z
    .array(z.string().email().max(254))
    .min(1)
    .max(EXACT_EMAIL_LIMIT)
    .optional(),
});

export const normalizeE2EEmailDomain = (value: string): string => {
  const domain = value.trim().toLowerCase();
  const isValid =
    domain.length <= 253 &&
    domain.includes(".") &&
    !domain.includes("@") &&
    domain
      .split(".")
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  if (!isValid) {
    throw new Error("E2E_EMAIL_DOMAIN is invalid");
  }
  return domain;
};

export const isE2EEmail = (email: string, domain: string): boolean => {
  const normalized = email.trim().toLowerCase();
  const suffix = `@${domain}`;
  if (!normalized.endsWith(suffix)) {
    return false;
  }
  const localPart = normalized.slice(0, -suffix.length);
  return /^e2e-[a-z0-9][a-z0-9-]{0,100}$/.test(localPart);
};

export const isWithinCleanupAge = ({
  createdAt,
  maxAgeMs,
  minAgeMs,
  now,
}: {
  createdAt: Date | number;
  maxAgeMs: number;
  minAgeMs: number;
  now: number;
}): boolean => {
  const createdAtMs =
    createdAt instanceof Date ? createdAt.getTime() : createdAt;
  const ageMs = now - createdAtMs;
  return ageMs >= minAgeMs && ageMs <= maxAgeMs + CLOCK_SKEW_MS;
};

const runWithConcurrency = async <T>(
  values: T[],
  operation: (value: T) => Promise<void>
): Promise<PromiseSettledResult<void>[]> => {
  const results: PromiseSettledResult<void>[] = [];
  for (let index = 0; index < values.length; index += CLEANUP_CONCURRENCY) {
    const batch = values.slice(index, index + CLEANUP_CONCURRENCY);
    results.push(...(await Promise.allSettled(batch.map(operation))));
  }
  return results;
};

export const deleteE2ECleanupCandidates = async ({
  appCtx,
  authCtx,
  candidates,
}: {
  appCtx: ActionCtx;
  authCtx: CleanupAuthContext;
  candidates: CleanupCandidate[];
}) => {
  const results = await runWithConcurrency(candidates, async (candidate) => {
    await appCtx.runMutation(internal.auth.deleteAccountData, {
      userId: candidate.id,
    });
    await authCtx.internalAdapter.deleteUser(candidate.id);
  });

  const deleted: string[] = [];
  const failures: CleanupFailure[] = [];
  for (const [index, result] of results.entries()) {
    const candidate = candidates[index];
    if (result.status === "fulfilled") {
      deleted.push(candidate.email);
    } else {
      console.error(`E2E cleanup failed for ${candidate.email}`, result.reason);
      failures.push({
        email: candidate.email,
        reason: "account cleanup failed",
      });
    }
  }
  return { deleted, failures };
};

export const resolveExactE2ECleanupCandidates = async ({
  authCtx,
  domain,
  emails,
  now,
}: {
  authCtx: CleanupAuthContext;
  domain: string;
  emails: string[];
  now: number;
}) => {
  const uniqueEmails = [...new Set(emails.map((email) => email.toLowerCase()))];
  if (uniqueEmails.some((email) => !isE2EEmail(email, domain))) {
    throw new APIError("BAD_REQUEST", { message: "Invalid E2E email" });
  }

  const records = await Promise.all(
    uniqueEmails.map(async (email) => ({
      email,
      result: await authCtx.internalAdapter.findUserByEmail(email),
    }))
  );
  const alreadyDeleted: string[] = [];
  const candidates: CleanupCandidate[] = [];
  const ignoredOutOfRange: string[] = [];
  for (const record of records) {
    if (!record.result) {
      alreadyDeleted.push(record.email);
      continue;
    }
    const candidate = record.result.user;
    if (
      !isWithinCleanupAge({
        createdAt: candidate.createdAt,
        maxAgeMs: EXACT_MAX_AGE_MS,
        minAgeMs: -CLOCK_SKEW_MS,
        now,
      })
    ) {
      ignoredOutOfRange.push(record.email);
      continue;
    }
    candidates.push(candidate);
  }
  return { alreadyDeleted, candidates, ignoredOutOfRange };
};

export const resolveOrphanE2ECleanupCandidates = async ({
  authCtx,
  domain,
  now,
}: {
  authCtx: CleanupAuthContext;
  domain: string;
  now: number;
}) => {
  const users = await authCtx.internalAdapter.listUsers(
    MAX_CANDIDATES_PER_RUN + 1,
    0,
    { direction: "asc", field: "createdAt" },
    [
      { field: "email", operator: "starts_with", value: "e2e-" },
      { field: "email", operator: "ends_with", value: `@${domain}` },
      {
        field: "createdAt",
        operator: "gte",
        value: new Date(now - ORPHAN_MAX_AGE_MS),
      },
      {
        field: "createdAt",
        operator: "lte",
        value: new Date(now - ORPHAN_MIN_AGE_MS),
      },
    ]
  );
  const eligible = users.filter(
    (user) =>
      isE2EEmail(user.email, domain) &&
      isWithinCleanupAge({
        createdAt: user.createdAt,
        maxAgeMs: ORPHAN_MAX_AGE_MS,
        minAgeMs: ORPHAN_MIN_AGE_MS,
        now,
      })
  );
  return {
    candidates: eligible.slice(0, MAX_CANDIDATES_PER_RUN),
    remainingEligible: eligible.length > MAX_CANDIDATES_PER_RUN,
  };
};

export const e2eCleanupPlugin = (
  appCtx: GenericCtx<DataModel>
): BetterAuthPlugin => ({
  id: "teak-e2e-cleanup",
  endpoints: {
    cleanupE2EAccounts: createAuthEndpoint(
      "/internal/e2e/cleanup",
      { method: "POST", body: requestSchema },
      async (ctx) => {
        const expectedToken = process.env.E2E_CLEANUP_TOKEN;
        const emailDomain = process.env.E2E_EMAIL_DOMAIN;
        if (!(expectedToken && emailDomain)) {
          throw new APIError("SERVICE_UNAVAILABLE", {
            message: "E2E cleanup is not configured",
          });
        }
        if (ctx.headers?.get("authorization") !== `Bearer ${expectedToken}`) {
          throw new APIError("UNAUTHORIZED", { message: "Unauthorized" });
        }

        const domain = normalizeE2EEmailDomain(emailDomain);
        const now = Date.now();
        const exact = ctx.body.emails
          ? await resolveExactE2ECleanupCandidates({
              authCtx: ctx.context,
              domain,
              emails: ctx.body.emails,
              now,
            })
          : null;
        const orphan = exact
          ? null
          : await resolveOrphanE2ECleanupCandidates({
              authCtx: ctx.context,
              domain,
              now,
            });
        const candidates = exact?.candidates ?? orphan?.candidates ?? [];
        const deleted = await deleteE2ECleanupCandidates({
          appCtx: requireActionCtx(appCtx),
          authCtx: ctx.context,
          candidates,
        });
        const result: E2ECleanupResult = {
          alreadyDeleted: exact?.alreadyDeleted ?? [],
          deleted: deleted.deleted,
          failures: deleted.failures,
          ignoredOutOfRange: exact?.ignoredOutOfRange ?? [],
          remainingEligible: orphan?.remainingEligible ?? false,
        };
        const ineffective =
          result.failures.length > 0 ||
          result.ignoredOutOfRange.length > 0 ||
          result.remainingEligible;
        return ctx.json(result, { status: ineffective ? 500 : 200 });
      }
    ),
  },
});
