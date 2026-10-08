import { describe, expect, mock, test } from "bun:test";
import { type FunctionReference, getFunctionAddress } from "convex/server";
import crons from "../crons";
import { cleanupResendEmails } from "../telemetry/crons";

const EXPECTED_CRONS: Record<string, { cron: string; handler: string }> = {
  "workos-daily-reconciliation-audit": {
    cron: "30 4 * * *",
    handler: "workosDailyReconciliationAudit",
  },
  "redrive-account-deletion": {
    cron: "*/5 * * * *",
    handler: "redriveAccountDeletion",
  },
  "cleanup-expired-idempotency": {
    cron: "10 * * * *",
    handler: "cleanupExpiredIdempotency",
  },
  "cleanup-resend-emails": {
    cron: "0 6 * * *",
    handler: "cleanupResendEmails",
  },
  "cleanup-old-deleted-cards": {
    cron: "0 2 * * *",
    handler: "cleanupOldDeletedCards",
  },
  "cleanup-abandoned-import-uploads": {
    cron: "0 * * * *",
    handler: "cleanupAbandonedImportUploads",
  },
  "cleanup-stale-pending-card-uploads": {
    cron: "30 * * * *",
    handler: "cleanupStalePendingCardUploads",
  },
  "sweep-orphaned-objects": {
    cron: "0 4 * * 1",
    handler: "sweepOrphanedObjects",
  },
  "reap-stuck-workflows": {
    cron: "0 5 * * 1",
    handler: "reapStuckWorkflows",
  },
  "ai-metadata-backfill": {
    cron: "0 */6 * * *",
    handler: "aiMetadataBackfill",
  },
  "cleanup-expired-exports": {
    cron: "0 3 * * *",
    handler: "cleanupExpiredExports",
  },
};

describe("crons.ts", () => {
  test("registers exactly the expected cron identifiers", () => {
    expect(Object.keys(crons.crons).sort()).toEqual(
      Object.keys(EXPECTED_CRONS).sort()
    );
  });

  for (const [identifier, expected] of Object.entries(EXPECTED_CRONS)) {
    test(`${identifier} runs ${expected.cron} via ${expected.handler} with empty args`, () => {
      const job = crons.crons[identifier];
      expect(job.schedule).toEqual({ cron: expected.cron, type: "cron" });
      expect(job.name).toContain(expected.handler);
      expect(job.args).toEqual([{}]);
    });
  }
});

test("email retention awaits component cleanup with safe horizons", async () => {
  const calls: {
    reference: string | undefined;
    args: { olderThan: number };
  }[] = [];
  const runMutation = mock(
    (ref: FunctionReference<"mutation">, args: { olderThan: number }) => {
      calls.push({ reference: getFunctionAddress(ref).reference, args });
      return Promise.resolve(null);
    }
  );
  await (
    cleanupResendEmails as unknown as {
      _handler: (ctx: unknown, args: object) => Promise<null>;
    }
  )._handler({ runMutation }, {});
  expect(calls).toEqual([
    {
      reference: "_reference/childComponent/resend/lib/cleanupOldEmails",
      args: { olderThan: 7 * 24 * 60 * 60 * 1000 },
    },
    {
      reference: "_reference/childComponent/resend/lib/cleanupAbandonedEmails",
      args: { olderThan: 28 * 24 * 60 * 60 * 1000 },
    },
  ]);
});

for (const failingBatch of [1, 2]) {
  test(`email cleanup reports a failure in batch ${failingBatch}`, async () => {
    let calls = 0;
    const runMutation = mock(() => {
      calls += 1;
      if (calls === failingBatch) {
        return Promise.reject(new Error("cleanup_failed"));
      }
      return Promise.resolve(null);
    });
    await expect(
      (
        cleanupResendEmails as unknown as {
          _handler: (ctx: unknown, args: object) => Promise<null>;
        }
      )._handler({ runMutation }, {})
    ).rejects.toThrow("cleanup_failed");
    expect(calls).toBe(failingBatch);
  });
}
