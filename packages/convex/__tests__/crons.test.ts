import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CRONS, cronTasksOn } from "../cronSchedules";
import crons from "../crons";

const EXPECTED_CRONS: Record<string, { cron: string; handler: string }> = {
  "workos-event-catch-up": {
    cron: "15 * * * *",
    handler: "workosEventCatchUp",
  },
  "cleanup-expired-idempotency": {
    cron: "10 * * * *",
    handler: "cleanupExpiredIdempotency",
  },
  "cleanup-abandoned-import-uploads": {
    cron: "0 * * * *",
    handler: "cleanupAbandonedImportUploads",
  },
  "cleanup-expired-upload-sessions": {
    cron: "30 * * * *",
    handler: "cleanupExpiredUploadSessions",
  },
  "cleanup-semantic-search-cache": {
    cron: "40 * * * *",
    handler: "cleanupSemanticSearchCache",
  },
  "cleanup-inbound-email-receipts": {
    cron: "20 3 * * *",
    handler: "cleanupInboundEmailReceipts",
  },
};

const WORKER_DIR = join(import.meta.dir, "../../../apps/files-worker");
const WRANGLER_CONFIGS = [
  join(WORKER_DIR, "wrangler.jsonc"),
  join(WORKER_DIR, "development/wrangler.jsonc"),
];

const triggerCrons = (path: string): string[] =>
  (
    Bun.JSONC.parse(readFileSync(path, "utf-8")) as {
      triggers?: { crons?: string[] };
    }
  ).triggers?.crons ?? [];

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

  test("never registers a task the Files Worker runs", () => {
    for (const task of cronTasksOn("cloudflare")) {
      expect(crons.crons[CRONS[task].name]).toBeUndefined();
    }
  });

  test.each(WRANGLER_CONFIGS)(
    "the Cloudflare tasks' schedules are exactly the Cron Triggers in %s",
    (path) => {
      const schedules = new Set(
        cronTasksOn("cloudflare").map((task) => CRONS[task].schedule)
      );
      expect([...new Set(triggerCrons(path))].sort()).toEqual(
        [...schedules].sort()
      );
    }
  );
});
