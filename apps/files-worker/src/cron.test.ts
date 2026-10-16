import { describe, expect, test } from "bun:test";
import { CRONS } from "@teak/convex/cronSchedules";
import { createConvexRpc } from "./convexRpc";
import { type CronDeps, type CronEnv, handleScheduled } from "./cron";
import { createFakeConvex, TEST_SIGNING_SECRET } from "./test/fakeConvex";

const PROD = "https://prod-deployment.convex.site";
const DEV = "https://dev-deployment.convex.site";
const SCHEDULED_AT = Date.parse("2026-10-19T04:00:00Z");

const env = (overrides: Partial<CronEnv> = {}) =>
  ({
    ANALYTICS_ACCOUNT_ID: "account",
    ANALYTICS_API_TOKEN: "token",
    CONVEX_SITE_URLS: `${PROD},${DEV}`,
    FILES_SIGNING_SECRET: TEST_SIGNING_SECRET,
    ...overrides,
  }) as CronEnv;

const setup = (deps: Partial<CronDeps> = {}) => {
  const fakes = new Map(
    [PROD, DEV].map((url) => [
      url,
      createFakeConvex({ "adminHealth:recordCronRun": () => null }),
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
  return { calls, heartbeats, run };
};

describe("Cron Triggers", () => {
  test.each([
    ["0 2 * * *", "card-cleanup"],
    ["0 3 * * *", "export-cleanup"],
  ])(
    "%s starts %s in every deployment without its own heartbeat",
    async (cron, task) => {
      const { calls, heartbeats, run } = setup();
      await run(cron);
      expect(calls.sort()).toEqual(
        [PROD, DEV]
          .map(
            (url) => `${task} ${url} ${new Date(SCHEDULED_AT).toISOString()}`
          )
          .sort()
      );
      expect([...heartbeats(PROD), ...heartbeats(DEV)]).toEqual([]);
    }
  );

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

  test("the hourly crons roll up AI usage and reconcile workflows per deployment", async () => {
    const { calls, heartbeats, run } = setup();
    await run("15 * * * *");
    await run("45 * * * *");
    expect(calls.sort()).toEqual(
      [`rollup ${DEV}`, `rollup ${PROD}`, "reconcile", "reconcile"].sort()
    );
    expect(heartbeats(PROD)).toEqual([
      "ai-usage-rollup started",
      "ai-usage-rollup succeeded",
      "reconcile-workflows started",
      "reconcile-workflows succeeded",
    ]);
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
