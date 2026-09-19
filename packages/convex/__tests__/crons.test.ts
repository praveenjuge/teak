import { describe, expect, test } from "bun:test";
import crons from "../crons";

const EXPECTED_CRONS: Record<string, { cron: string; handler: string }> = {
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
