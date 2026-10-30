import { describe, expect, test } from "bun:test";
import { CRONS } from "@teak/convex/cronSchedules";
import { createConvexRpc } from "../convexRpc";
import {
  createFakeConvex,
  type FakeHandler,
  TEST_RPC_ROOT_SECRET,
  TEST_SIGNING_SECRET,
} from "../test/fakeConvex";
import { FakeBucket } from "../test/testsupport";
import { type CronDeps, type CronEnv, handleScheduled } from "./cron";

const PROD = "https://prod-deployment.convex.site";
const DEV = "https://dev-deployment.convex.site";
const SCHEDULED_AT = Date.parse("2026-10-19T04:00:00Z");

const env = (overrides: Partial<CronEnv> = {}) =>
  ({
    ANALYTICS_ACCOUNT_ID: "account",
    ANALYTICS_API_TOKEN: "token",
    BUCKET: new FakeBucket() as unknown as R2Bucket,
    CONVEX_SITE_URLS: `${PROD},${DEV}`,
    FILES_SIGNING_SECRET: TEST_SIGNING_SECRET,
    WORKFLOW_RPC_ROOT_SECRET: TEST_RPC_ROOT_SECRET,
    ...overrides,
  }) as CronEnv;

const nothingExpired = () => ({ deleted: 0, hasMore: false });

const setup = (
  deps: Partial<CronDeps> = {},
  handlers: Record<string, FakeHandler> = {}
) => {
  const fakes = new Map(
    [PROD, DEV].map((url) => [
      url,
      createFakeConvex({
        "adminHealth:recordCronRun": () => null,
        "dataImport:findExpiredUploads": () => [],
        "fileUploads:findExpiredSessions": () => [],
        "operationalRetention:startIdempotencyCleanup": () => null,
        "search/relevanceCache:cleanupExpired": nothingExpired,
        "search/semanticCache:cleanupExpired": nothingExpired,
        ...handlers,
      }),
    ])
  );
  const calls: string[] = [];
  const run = async (cron: string, cronEnv = env()) => {
    await handleScheduled(
      { cron, scheduledTime: SCHEDULED_AT },
      cronEnv,
      { waitUntil: () => undefined },
      {
        convex: (url) => createConvexRpc(cronEnv, url, fakes.get(url)?.fetcher),
        enqueueAiBackfill: (_env, url) => {
          calls.push(`ai-backfill ${url}`);
          return Promise.resolve(3);
        },
        reconcileWorkflows: () => {
          calls.push("reconcile");
          return Promise.resolve({
            checked: 0,
            completed: 0,
            errored: 0,
            pruned: 0,
            running: 0,
          });
        },
        rollUpAiUsage: (_env, url) => {
          calls.push(`rollup ${url}`);
          return Promise.resolve(1);
        },
        startMaintenanceTask: (_env, url, task, now) => {
          calls.push(`${task} ${url} ${now.toISOString()}`);
          return Promise.resolve();
        },
        sweepStalePendingUploads: () => {
          calls.push("pending-sweep");
          return Promise.resolve({ complete: true, deleted: 0 });
        },
        ...deps,
      }
    );
  };
  const heartbeats = (url: string) =>
    (fakes.get(url)?.callsTo("adminHealth:recordCronRun") ?? []).map(
      ({ args }) => `${String(args.name)} ${String(args.phase)}`
    );
  const convexCalls = (url: string, name: string) =>
    fakes.get(url)?.callsTo(name) ?? [];
  return { calls, convexCalls, heartbeats, run };
};

describe("Cron Triggers", () => {
  test.each([
    [CRONS.cleanupOldDeletedCards.schedule, ["card-cleanup", "admin-snapshot"]],
    [
      CRONS.cleanupExpiredExports.schedule,
      ["export-cleanup", "receipt-cleanup"],
    ],
  ])(
    "%s starts %p in every deployment without its own heartbeat",
    async (cron, tasks) => {
      const { calls, heartbeats, run } = setup();
      await run(cron);
      expect(calls.sort()).toEqual(
        tasks
          .flatMap((task) =>
            [PROD, DEV].map(
              (url) => `${task} ${url} ${new Date(SCHEDULED_AT).toISOString()}`
            )
          )
          .sort()
      );
      expect([...heartbeats(PROD), ...heartbeats(DEV)]).toEqual([]);
    }
  );

  test("the admin snapshot starts once a day on its own schedule", async () => {
    const { calls, run } = setup();
    await run(CRONS.adminDailySnapshot.schedule);
    await run("15 * * * *");
    await run("45 * * * *");
    expect(
      calls
        .filter((call) => call.startsWith("admin-"))
        .map((call) => call.split(" ").slice(0, 2).join(" "))
        .sort()
    ).toEqual([`admin-snapshot ${DEV}`, `admin-snapshot ${PROD}`].sort());
  });

  test("the weekly cron sweeps orphans per deployment and pending uploads once", async () => {
    const { calls, heartbeats, run } = setup();
    await run("0 4 * * 1");
    expect(calls.filter((call) => call === "pending-sweep")).toHaveLength(1);
    expect(
      calls.filter((call) => call.startsWith("orphan-sweep"))
    ).toHaveLength(2);
    for (const url of [PROD, DEV]) {
      expect(heartbeats(url)).toEqual([
        `${CRONS.sweepStalePendingUploads.name} started`,
        `${CRONS.sweepStalePendingUploads.name} succeeded`,
      ]);
    }
  });

  test("one deployment's failure neither stops another nor hides itself", async () => {
    const { heartbeats, run } = setup({
      enqueueAiBackfill: (_env, url) =>
        url === PROD
          ? Promise.reject(new Error("claim failed"))
          : Promise.resolve(2),
    });
    await run("0 */6 * * *");
    expect(heartbeats(PROD)).toEqual([
      "ai-metadata-backfill started",
      "ai-metadata-backfill failed",
    ]);
    expect(heartbeats(DEV)).toEqual([
      "ai-metadata-backfill started",
      "ai-metadata-backfill succeeded",
    ]);
  });

  test("the hourly crons roll up AI usage, reconcile workflows and run every hourly cleanup per deployment", async () => {
    const { calls, convexCalls, heartbeats, run } = setup();
    await run("15 * * * *");
    await run("45 * * * *");
    expect(calls.sort()).toEqual(
      [`rollup ${DEV}`, `rollup ${PROD}`, "reconcile", "reconcile"].sort()
    );
    const ran = [
      "ai-usage-rollup",
      "reconcile-workflows",
      CRONS.cleanupExpiredIdempotency.name,
      CRONS.cleanupAbandonedImportUploads.name,
      CRONS.cleanupExpiredUploadSessions.name,
      CRONS.cleanupSemanticSearchCache.name,
    ];
    for (const url of [PROD, DEV]) {
      expect(heartbeats(url).sort()).toEqual(
        ran.flatMap((name) => [`${name} started`, `${name} succeeded`]).sort()
      );
      expect(
        convexCalls(url, "operationalRetention:startIdempotencyCleanup")
      ).toHaveLength(1);
    }
  });

  test("a failed hourly cleanup is recorded without stopping the others", async () => {
    const { heartbeats, run } = setup(
      {},
      {
        "dataImport:findExpiredUploads": () => {
          throw new Error("query failed");
        },
      }
    );
    await run("45 * * * *");
    const outcomes = heartbeats(PROD).filter(
      (heartbeat) => !heartbeat.endsWith("started")
    );
    expect(outcomes).toContain(
      `${CRONS.cleanupAbandonedImportUploads.name} failed`
    );
    expect(outcomes).toContain(
      `${CRONS.cleanupExpiredUploadSessions.name} succeeded`
    );
    expect(outcomes).toContain(
      `${CRONS.cleanupSemanticSearchCache.name} succeeded`
    );
  });

  test("the AI usage rollup records nothing where the SQL API is not configured", async () => {
    const { calls, heartbeats, run } = setup();
    await run("15 * * * *", env({ ANALYTICS_API_TOKEN: undefined }));
    expect(calls).toEqual([]);
    expect(heartbeats(PROD)).toEqual([]);
  });

  test("a failed pending upload sweep is recorded in every deployment", async () => {
    const { heartbeats, run } = setup({
      sweepStalePendingUploads: () => Promise.reject(new Error("list failed")),
    });
    await run("0 4 * * 1");
    for (const url of [PROD, DEV]) {
      expect(heartbeats(url)).toEqual([
        "sweep-stale-pending-uploads started",
        "sweep-stale-pending-uploads failed",
      ]);
    }
  });
});
