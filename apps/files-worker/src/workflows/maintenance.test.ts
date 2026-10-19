import { describe, expect, test } from "bun:test";
import { utcDay } from "@teak/convex/adminStats";
import type { MaintenanceParams, MaintenanceTask } from "@teak/files-protocol";
import { fakeConvexEnv, TEST_CONVEX_SITE_URL } from "../test/fakeConvex";
import { completionReports, createTestRun } from "../test/fakeRun";
import type { FilesOpCaller } from "./deps";
import { callFilesOp } from "./filesOps";
import { runMaintenance, startMaintenanceTask } from "./maintenance";
import type { BackgroundEnv } from "./runtime";

const DAY_MS = 24 * 60 * 60 * 1000;

const fakeMaintenance = (errors: Array<{ code: number; message: string }>) => {
  const created: Array<{ id: string; params: unknown }> = [];
  const binding = {
    createBatch: (batch: {
      instances: Array<{ id: string; params: unknown }>;
    }) => {
      created.push(...batch.instances);
      return Promise.resolve({
        created: [],
        errors: errors.map((error) => ({ ...error, index: 0 })),
      });
    },
  };
  return { binding: binding as unknown as Workflow, created };
};

const heartbeats = (calls: ReturnType<typeof createTestRun>["calls"]) =>
  calls
    .filter((call) => call.name === "adminHealth:recordCronRun")
    .map((call) => `${String(call.args.name)} ${String(call.args.phase)}`);

const setup = (
  task: MaintenanceTask,
  handlers: Parameters<typeof createTestRun>[1]["handlers"]
) =>
  createTestRun(
    { task },
    {
      handlers: { "adminHealth:recordCronRun": () => null, ...handlers },
    }
  );

describe("startMaintenanceTask", () => {
  test("names the instance by task, UTC day and deployment", async () => {
    const workflows = fakeMaintenance([]);
    const env = {
      ...fakeConvexEnv,
      MAINTENANCE: workflows.binding,
    } as unknown as BackgroundEnv;
    const now = new Date("2026-10-16T02:00:00Z");

    await startMaintenanceTask(env, TEST_CONVEX_SITE_URL, "card-cleanup", now);
    await startMaintenanceTask(
      env,
      "https://other-deployment.convex.site",
      "card-cleanup",
      now
    );

    const [first, second] = workflows.created;
    expect(first?.id).toMatch(/^card-cleanup-2026-10-16-[0-9a-f]{8}$/u);
    expect(second?.id).toMatch(/^card-cleanup-2026-10-16-[0-9a-f]{8}$/u);
    expect(first?.id).not.toBe(second?.id);
    expect(first?.params).toEqual({
      convexSiteUrl: TEST_CONVEX_SITE_URL,
      task: "card-cleanup",
    });
  });

  test("names an hourly task's instance by the hour", async () => {
    const workflows = fakeMaintenance([]);
    const env = {
      ...fakeConvexEnv,
      MAINTENANCE: workflows.binding,
    } as unknown as BackgroundEnv;

    await startMaintenanceTask(
      env,
      TEST_CONVEX_SITE_URL,
      "admin-overview",
      new Date("2026-10-16T02:45:00Z")
    );
    await startMaintenanceTask(
      env,
      TEST_CONVEX_SITE_URL,
      "admin-overview",
      new Date("2026-10-16T03:45:00Z")
    );

    expect(workflows.created.map(({ id }) => id.slice(0, 29))).toEqual([
      "admin-overview-2026-10-16T02-",
      "admin-overview-2026-10-16T03-",
    ]);
  });

  test("a second firing the same day is a no-op, but other failures throw", async () => {
    const env = (code: number) =>
      ({
        ...fakeConvexEnv,
        MAINTENANCE: fakeMaintenance([{ code, message: "nope" }]).binding,
      }) as unknown as BackgroundEnv;

    await startMaintenanceTask(
      env(10_405),
      TEST_CONVEX_SITE_URL,
      "orphan-sweep"
    );
    await expect(
      startMaintenanceTask(env(10_001), TEST_CONVEX_SITE_URL, "orphan-sweep")
    ).rejects.toThrow("maintenance_start_failed:nope");
  });
});

describe("card cleanup", () => {
  test("pages through every card past retention, then prunes tombstones", async () => {
    const trash = Array.from({ length: 23 }, (_, index) => `card-${index}`);
    let cutoffs: number[] = [];
    const test = setup("card-cleanup", {
      "card/trashCleanup:cleanupDeletedCard": ({ cardId, cutoff }) => {
        cutoffs.push(cutoff as number);
        trash.splice(trash.indexOf(cardId as string), 1);
        return { deleted: true };
      },
      "card/trashCleanup:getCardsPendingCleanup": ({ limit }) =>
        trash.slice(0, limit as number).map((_id) => ({ _id })),
      "publicApiTombstones:pruneExpiredCardTombstones": () => ({
        deleted: 0,
        hasMore: false,
      }),
    });

    expect(await runMaintenance(test.run, { convex: test.convex })).toEqual({
      cleaned: 23,
    });

    expect(trash).toEqual([]);
    cutoffs = [...new Set(cutoffs)];
    expect(cutoffs).toHaveLength(1);
    expect(cutoffs[0]).toBeLessThanOrEqual(Date.now() - 30 * DAY_MS);
    expect(
      test.callsTo("publicApiTombstones:pruneExpiredCardTombstones")
    ).toHaveLength(1);
    expect(heartbeats(test.calls)).toEqual([
      "cleanup-old-deleted-cards started",
      "cleanup-old-deleted-cards succeeded",
    ]);
  });

  test("a page whose cards can't be deleted ends the run instead of looping", async () => {
    const stuck = Array.from({ length: 10 }, (_, index) => ({
      _id: `card-${index}`,
    }));
    const test = setup("card-cleanup", {
      "card/trashCleanup:cleanupDeletedCard": () => ({ deleted: false }),
      "card/trashCleanup:getCardsPendingCleanup": () => stuck,
      "publicApiTombstones:pruneExpiredCardTombstones": () => ({
        deleted: 0,
        hasMore: false,
      }),
    });

    expect(await runMaintenance(test.run, { convex: test.convex })).toEqual({
      cleaned: 0,
    });
    expect(
      test.callsTo("card/trashCleanup:getCardsPendingCleanup")
    ).toHaveLength(1);
  });
});

describe("export cleanup", () => {
  const artifact = (job: string) => `exports/0123456789abcdef/${job}.zip`;

  test("expires jobs whose archive is deleted and keeps one whose delete failed", async () => {
    const ready = new Set(["job-a", "job-b", "job-c"]);
    const expired: string[] = [];
    const test = setup("export-cleanup", {
      "adminHealth:recordCronRun": () => null,
      "dataExport:deleteJobItemsPage": () => ({ deleted: 0, hasMore: false }),
      "dataExport:expireJob": ({ jobId }) => {
        ready.delete(jobId as string);
        expired.push(jobId as string);
        return null;
      },
      "dataExport:findExpiredReadyJobs": ({ limit }) =>
        [...ready]
          .slice(0, limit as number)
          .map((_id) => ({ _id, artifactKey: artifact(_id) })),
    });
    for (const job of ready) {
      for (const suffix of ["", ".checkpoint.json", ".result.json"]) {
        test.bucket.objects.set(`${artifact(job)}${suffix}`, {
          bytes: new Uint8Array([1]),
        });
      }
    }
    const ops: FilesOpCaller = (spec) =>
      (spec.params.keys as string[]).includes(artifact("job-b"))
        ? Promise.reject(new Error("files_worker_error:INTERNAL:500:r"))
        : callFilesOp(test.env, spec);

    await expect(
      runMaintenance(test.run, { convex: test.convex, ops })
    ).rejects.toThrow("export_artifact_delete_failed:1");

    expect(expired).toEqual(["job-a", "job-c"]);
    expect(ready).toEqual(new Set(["job-b"]));
    expect([...test.bucket.objects.keys()]).toEqual([
      artifact("job-b"),
      `${artifact("job-b")}.checkpoint.json`,
      `${artifact("job-b")}.result.json`,
    ]);
    expect(heartbeats(test.calls)).toEqual([
      "cleanup-expired-exports started",
      "cleanup-expired-exports failed",
    ]);
  });
});

describe("orphan sweep", () => {
  test("reports week-old objects nothing references and sweeps the vector ledger", async () => {
    const old = Date.now() - 8 * DAY_MS;
    const test = setup("orphan-sweep", {
      "embedding/sweep:sweepVectorLedger": () => ({ complete: true }),
      "storage/orphanSweep:collectNonCardReferencedKeys": () => [
        "users/u1/imports/source.zip",
      ],
      "storage/orphanSweep:listPrefix": () => "users/",
      "storage/orphanSweep:logOrphanReport": () => null,
      "storage/orphanSweep:pageSweepCards": ({ cursor }) =>
        cursor
          ? {
              cards: [{ thumbnailKey: "users/u1/cards/c2/thumb.webp" }],
              continueCursor: "",
              isDone: true,
            }
          : {
              cards: [{ fileKey: "users/u1/cards/c1/file/a.png" }],
              continueCursor: "page-2",
              isDone: false,
            },
    });
    const put = (key: string, uploadedAt: number, size = 10) =>
      test.bucket.objects.set(key, {
        bytes: new Uint8Array(size),
        uploadedAt,
      });
    put("users/u1/cards/c1/file/a.png", old);
    put("users/u1/cards/c2/thumb.webp", old);
    put("users/u1/imports/source.zip", old);
    put("users/u1/cards/gone/file/b.png", old, 25);
    put("users/u1/cards/new/file/c.png", Date.now());

    await runMaintenance(test.run, { convex: test.convex });

    expect(
      test.callsTo("storage/orphanSweep:logOrphanReport")[0]?.args
    ).toEqual({ orphanBytes: 25, orphanCount: 1, scannedObjects: 5 });
    expect(test.callsTo("embedding/sweep:sweepVectorLedger")).toHaveLength(1);
    expect(heartbeats(test.calls)).toEqual([
      "sweep-orphaned-objects started",
      "sweep-orphaned-objects succeeded",
    ]);
  });
});

const pages =
  <T>(...contents: T[][]) =>
  ({ cursor }: Record<string, unknown>) => {
    const index = cursor === null ? 0 : Number(cursor);
    return {
      rows: contents[index] ?? [],
      isDone: index >= contents.length - 1,
      continueCursor: String(index + 1),
    };
  };

const snapshotRun = (
  params: Omit<MaintenanceParams, "task">,
  handlers: Parameters<typeof createTestRun>[1]["handlers"] = {}
) => {
  const flagged: string[][] = [];
  const written: Record<string, unknown>[] = [];
  const test = createTestRun(
    { task: "admin-snapshot", ...params },
    {
      handlers: {
        "adminAccess:flagAutoInternalAccounts": ({ teakUserIds }) => {
          flagged.push(teakUserIds as string[]);
          return (teakUserIds as string[]).length;
        },
        "adminAccess:listInternalUserIds": () => ["qa", "staff"],
        "adminHealth:recordCronRun": () => null,
        "adminMetrics:cardsPage": pages(),
        "adminMetrics:readSnapshotBilling": () => ({
          billing: {
            canceling: 0,
            currency: "usd",
            mrr: 500,
            mrrAtRisk: 0,
            netMrr: 460,
            pastDue: 0,
            paying: 1,
            trialing: 0,
          },
          isComplete: true,
        }),
        "adminMetrics:usersPage": pages(),
        "adminMetrics:writeSnapshot": ({ snapshot }) => {
          written.push(snapshot as Record<string, unknown>);
          return null;
        },
        "adminUsage:usageForDay": () => [],
        ...handlers,
      },
    }
  );
  return { flagged, test, written };
};

describe("admin snapshot", () => {
  test("pages every user and card, flags internal accounts and writes the day", async () => {
    const day = utcDay(Date.now() - DAY_MS);
    const dayStart = Date.parse(`${day}T00:00:00.000Z`);
    const user = (teakUserId: string, email: string, createdAt: number) => ({
      createdAt,
      deleted: false,
      email,
      isAdmin: false,
      teakUserId,
    });
    const card = (
      userId: string,
      createdAt: number,
      fileSize = 0,
      deleted = false
    ) => ({ createdAt, deleted, fileSize, userId });
    const { flagged, test, written } = snapshotRun(
      { date: day },
      {
        "adminMetrics:cardsPage": pages(
          [
            card("reader", dayStart + 3_600_000, 100),
            card("new", dayStart - 3 * DAY_MS),
          ],
          [
            card("qa", dayStart + 60_000, 999),
            card("reader", dayStart + DAY_MS + 60_000, 7),
            card("new", dayStart - 20 * DAY_MS, 50, true),
          ]
        ),
        "adminMetrics:usersPage": pages(
          [
            user("reader", "reader@gmail.com", dayStart - 10 * DAY_MS),
            user("new", "new@gmail.com", dayStart + 60_000),
          ],
          [
            user("qa", "e2e-bot@gmail.com", dayStart - DAY_MS),
            {
              ...user("gone", "gone@gmail.com", dayStart - DAY_MS),
              deleted: true,
            },
          ]
        ),
        "adminUsage:usageForDay": () => [
          { calls: 2, costUsd: 0.5, userId: "reader" },
          { calls: 9, costUsd: 3, userId: "qa" },
        ],
      }
    );

    expect(await runMaintenance(test.run, { convex: test.convex })).toEqual({
      date: day,
      isApproximate: false,
    });

    expect(flagged).toEqual([["qa"]]);
    expect(test.callsTo("adminMetrics:usersPage")).toHaveLength(2);
    expect(test.callsTo("adminMetrics:cardsPage")).toHaveLength(2);
    expect(written).toEqual([
      {
        accounts: 2,
        activeSavers1d: 1,
        activeSavers28d: 2,
        activeSavers7d: 2,
        aiCalls: 2,
        aiCostUsd: 0.5,
        billing: {
          canceling: 0,
          currency: "usd",
          mrr: 500,
          mrrAtRisk: 0,
          netMrr: 460,
          pastDue: 0,
          paying: 1,
          trialing: 0,
        },
        capturedAt: expect.any(Number),
        cardsSaved: 1,
        date: day,
        isApproximate: false,
        signups: 1,
        storageBytes: 100,
        storageBytesAdded: 100,
        topStorage: [{ bytes: 100, teakUserId: "reader" }],
        totalCards: 2,
      },
    ]);
    expect(heartbeats(test.calls)).toEqual([
      "admin-daily-snapshot started",
      "admin-daily-snapshot succeeded",
    ]);
  });

  test("an admin's request for an older day has no billing and reports back to its dispatch row", async () => {
    const day = utcDay(Date.now() - 5 * DAY_MS);
    const { test, written } = snapshotRun({ date: day, dispatched: true });

    await runMaintenance(test.run, { convex: test.convex });

    expect(test.callsTo("adminMetrics:readSnapshotBilling")).toEqual([]);
    expect(written).toHaveLength(1);
    expect(written[0]?.date).toBe(day);
    expect(written[0]).not.toHaveProperty("billing");
    expect(heartbeats(test.calls)).toEqual([]);
    expect(completionReports(test.callsTo)).toEqual(["complete"]);
  });

  test("a scan cut short marks the day approximate", async () => {
    const { test, written } = snapshotRun(
      { date: utcDay(Date.now() - DAY_MS) },
      {
        "adminMetrics:cardsPage": ({ cursor }) => ({
          rows: [],
          isDone: false,
          continueCursor: `${String(cursor)}+`,
        }),
      }
    );

    await runMaintenance(test.run, { convex: test.convex });

    expect(test.callsTo("adminMetrics:cardsPage")).toHaveLength(400);
    expect(written[0]?.isApproximate).toBe(true);
  });
});

describe("admin overview", () => {
  test("counts every card once and stores the overview with and without onboarding cards", async () => {
    const now = Date.now();
    const row = (
      cardId: string,
      userId: string,
      extra: Record<string, unknown> = {}
    ) => ({
      cardId,
      createdAt: now - DAY_MS,
      deleted: false,
      hasAiSummary: true,
      hasAiTags: true,
      hasAiTranscript: false,
      onboarding: false,
      type: "text",
      userId,
      ...extra,
    });
    const written: Record<string, unknown>[] = [];
    const test = createTestRun(
      { task: "admin-overview" },
      {
        handlers: {
          "admin:overviewCardsPage": pages(
            [
              row("c1", "reader"),
              row("c2", "reader", { onboarding: true }),
              row("c3", "staff"),
            ],
            [
              row("c4", "writer", {
                hasAiSummary: false,
                hasAiTags: false,
                metadataStatus: "pending",
                processingStatus: { classify: { status: "failed" } },
                type: "link",
              }),
            ]
          ),
          "admin:writeOverview": (args) => {
            written.push(args);
            return null;
          },
          "adminAccess:listInternalUserIds": () => ["staff"],
          "adminHealth:recordCronRun": () => null,
        },
      }
    );

    expect(await runMaintenance(test.run, { convex: test.convex })).toEqual({
      cards: 3,
      isApproximate: false,
    });

    const stored = (includeOnboarding: boolean) =>
      written.find((args) => args.includeOnboarding === includeOnboarding)
        ?.overview as {
        aiPipeline: { failedCards: number; missingCards: unknown[] };
        cardsByType: Record<string, number>;
        isApproximate: boolean;
        totals: { totalCards: number; uniqueUsers: number };
      };
    expect(written).toHaveLength(2);
    expect(stored(true).totals).toMatchObject({
      totalCards: 3,
      uniqueUsers: 2,
    });
    expect(stored(true).cardsByType).toEqual({ link: 1, text: 2 });
    expect(stored(false).totals).toMatchObject({
      totalCards: 2,
      uniqueUsers: 2,
    });
    expect(stored(false).aiPipeline.failedCards).toBe(1);
    expect(stored(false).aiPipeline.missingCards).toEqual([
      expect.objectContaining({
        cardId: "c4",
        reasons: [
          "AI metadata missing",
          "AI summary missing",
          "AI tags missing",
          "Link metadata still pending",
        ],
      }),
    ]);
    expect(stored(false).isApproximate).toBe(false);
    expect(heartbeats(test.calls)).toEqual([
      "admin-overview started",
      "admin-overview succeeded",
    ]);
  });
});
