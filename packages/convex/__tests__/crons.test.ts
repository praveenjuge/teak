import { describe, expect, mock, test } from "bun:test";
import { type FunctionReference, getFunctionAddress } from "convex/server";
import crons, { cleanupResendEmails } from "../crons";

const EXPECTED_CRONS: Record<string, { cron: string; handler: string }> = {
  "cleanup-resend-emails": {
    cron: "0 6 * * *",
    handler: "cleanupResendEmails",
  },
  "ensure-oauth-clients": {
    cron: "*/15 * * * *",
    handler: "ensureOauthClients",
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

test("email retention schedules bounded component cleanup with safe horizons", async () => {
  const runAfter = mock(
    (
      _delay: number,
      _reference: FunctionReference<"mutation">,
      _args: { olderThan: number }
    ) => Promise.resolve("scheduled")
  );
  await (
    cleanupResendEmails as unknown as {
      _handler: (ctx: unknown, args: object) => Promise<null>;
    }
  )._handler({ scheduler: { runAfter } }, {});
  expect(runAfter).toHaveBeenCalledTimes(2);
  expect(
    runAfter.mock.calls.map(
      (
        call: [number, FunctionReference<"mutation">, { olderThan: number }]
      ) => ({
        delay: call[0],
        reference: getFunctionAddress(call[1]).reference,
        args: call[2],
      })
    )
  ).toEqual([
    {
      delay: 0,
      reference: "_reference/childComponent/resend/lib/cleanupOldEmails",
      args: { olderThan: 7 * 24 * 60 * 60 * 1000 },
    },
    {
      delay: 0,
      reference: "_reference/childComponent/resend/lib/cleanupAbandonedEmails",
      args: { olderThan: 28 * 24 * 60 * 60 * 1000 },
    },
  ]);
});
