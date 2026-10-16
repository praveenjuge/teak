/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  convexForWorker,
  loadFilesWorker,
} from "./__tests__/helpers/filesWorker.test-utils";
import { internal } from "./_generated/api";
import schema from "./schema";
import { buildR2UserPrefix } from "./storage/r2";

vi.mock("@resvg/resvg-wasm/index_bg.wasm", () => ({ default: null }));
const filesWorker = await loadFilesWorker();
const modules = import.meta.glob("./**/*.ts");
const sourceKey = "users/import-test/imports/job/source.zip";
const setup = async (mode: "archive" | "bookmarks" = "archive") => {
  const t = convexTest(schema, modules);
  const jobId = await t.run((ctx) =>
    ctx.db.insert("importJobs", {
      userId: "import-test",
      mode,
      status: "parsing",
      phase: "Parsing",
      fileName: "source.zip",
      fileSize: 128,
      fileLastModified: 0,
      sourceKey,
      sourceEtag: '"stable"',
      parsedCount: 0,
      processedCount: 0,
      createdCount: 0,
      skippedCount: 0,
      failedCount: 0,
      createdAt: 0,
      updatedAt: 0,
    })
  );
  return { t, jobId };
};
beforeEach(() => {
  vi.stubEnv("FILES_BASE", "https://files.test");
  vi.stubEnv("FILES_SIGNING_SECRET", "test-secret");
  vi.stubEnv("R2_KEY_PREFIX", "");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("import orchestration through the worker", () => {
  test.each(
    [false, true].flatMap((reportFails) =>
      (["identity", "completed", "canceled"] as const).map((outcome) => ({
        reportFails,
        outcome,
      }))
    )
  )(
    "the Worker's $outcome run preserves its outcome and cleans unclaimed files (report failure: $reportFails)",
    async ({ reportFails, outcome }) => {
      vi.stubEnv("IDENTITY_RESOLVER_ENFORCE", "true");
      const { t, jobId } = await setup();
      const orphanKey = "users/import-test/imports/job/orphan.pdf";
      const ownedKey = "users/import-test/imports/job/owned.pdf";
      const extraKeys: string[] = [];
      await t.run(async (ctx) => {
        await ctx.db.insert("users", {
          teakUserId: "import-test",
          email: "import@example.com",
          emailVerified: true,
        });
        await ctx.db.patch(jobId, {
          status: "importing",
          failedCount: 1,
          cancelRequested: outcome === "canceled",
        });
        for (const [sourceIndex, status, extractedFileKey] of [
          [0, outcome === "identity" ? "pending" : "failed", orphanKey],
          [1, "created", ownedKey],
          [2, "failed", undefined],
        ] as const) {
          await ctx.db.insert("importJobItems", {
            jobId,
            userId: "import-test",
            sourceIndex,
            status,
            type: "document",
            content: "Extracted file",
            extractedFileKey,
            createdAt: 0,
            updatedAt: 0,
          });
        }
        if (outcome === "completed" && !reportFails) {
          for (let index = 3; index < 208; index++) {
            const extractedFileKey = `users/import-test/imports/job/orphan-${index}.pdf`;
            extraKeys.push(extractedFileKey);
            await ctx.db.insert("importJobItems", {
              jobId,
              userId: "import-test",
              sourceIndex: index,
              status: "failed",
              type: "document",
              content: "Unclaimed file",
              extractedFileKey,
              createdAt: 0,
              updatedAt: 0,
            });
          }
        }
      });
      const bucket = new filesWorker.FakeBucket();
      const put = bucket.put.bind(bucket);
      bucket.put = ((key: string, ...rest: unknown[]) =>
        reportFails && key.endsWith("error-report.txt")
          ? Promise.reject(new Error("r2 unavailable"))
          : put(key, ...(rest as [never]))) as typeof bucket.put;
      const deleted: string[] = [];
      const env = filesWorker.withObjectGates({
        BUCKET: bucket,
        FILES_SIGNING_SECRET: "test-secret",
        OBJECT_DELETIONS: {
          sendBatch: (messages: Array<{ body: { keys: string[] } }>) => {
            deleted.push(...messages.flatMap((message) => message.body.keys));
            return Promise.resolve();
          },
        },
      });

      await filesWorker.runImport(
        {
          env,
          instanceId: `import-${jobId}`,
          params: { jobId, convexSiteUrl: "https://session-tests.convex.site" },
          step: filesWorker.createFakeStep().step,
        },
        {
          convex: convexForWorker(t),
          ops: (spec: unknown) => filesWorker.callFilesOp(env, spec),
        }
      );

      const finalJob = await t.run((ctx) => ctx.db.get(jobId));
      expect(finalJob).toMatchObject({
        status: outcome === "identity" ? "failed" : outcome,
        ...(reportFails
          ? {}
          : {
              reportKey: `${buildR2UserPrefix("import-test")}/imports/${jobId}/error-report.txt`,
            }),
      });
      const reportFailure = reportFails
        ? "import_finalization_failed"
        : undefined;
      expect(finalJob?.failureClass).toBe(
        outcome === "identity" ? "identity_mapping_unavailable" : reportFailure
      );
      if (!reportFails) {
        expect(
          new TextDecoder().decode(
            bucket.storedBytes(finalJob?.reportKey as string) as Uint8Array
          )
        ).toContain("Teak import report");
      }
      expect(deleted).toContain(sourceKey);
      expect(deleted).toContain(orphanKey);
      for (const key of extraKeys) {
        expect(deleted).toContain(key);
      }
      expect(deleted).not.toContain(ownedKey);
      expect(await t.run((ctx) => ctx.db.query("cards").collect())).toEqual([]);
      const retryId = await t.mutation(internal.dataImport.reserveJob, {
        userId: "import-test",
        mode: "archive",
        fileName: "retry.zip",
        fileSize: 128,
        fileLastModified: 0,
        sourceKey,
        uploadExpiresAt: Date.now() + 60_000,
      });
      expect(retryId).not.toBe(jobId);
    }
  );
  test("queueing an upload starts its import run and records the instance", async () => {
    const { t, jobId } = await setup();
    await t.run((ctx) => ctx.db.patch(jobId, { status: "uploading" }));
    await t.mutation(internal.dataImport.markQueued, { jobId });
    const job = await t.run((ctx) => ctx.db.get(jobId));
    expect(job).toMatchObject({
      status: "queued",
      workflowId: `import-${jobId}`,
    });
    expect(
      await t.run((ctx) => ctx.db.query("workflowDispatches").collect())
    ).toMatchObject([
      {
        kind: "import",
        instanceId: `import-${jobId}`,
        params: { jobId },
        state: "pending",
      },
    ]);
  });
  test("the run reads its job with the owner's storage prefix", async () => {
    const { t, jobId } = await setup();
    expect(
      await t.query(internal.dataImport.getWorkflowJob, { jobId })
    ).toMatchObject({
      userId: "import-test",
      mode: "archive",
      status: "parsing",
      sourceKey,
      sourceEtag: '"stable"',
      cancelRequested: false,
      userKeyPrefix: buildR2UserPrefix("import-test"),
    });
  });
  test("a rejected import blocks retries until cleanup records its terminal failure", async () => {
    vi.stubEnv("IDENTITY_RESOLVER_ENFORCE", "true");
    const { t, jobId } = await setup();
    const itemId = await t.run((ctx) =>
      ctx.db.insert("importJobItems", {
        jobId,
        userId: "import-test",
        sourceIndex: 0,
        status: "pending",
        type: "text",
        content: "Must stay pending",
        createdAt: 0,
        updatedAt: 0,
      })
    );
    expect(
      await t.mutation(internal.dataImport.createPendingBatch, {
        jobId,
        itemIds: [itemId],
      })
    ).toEqual({
      limitReached: false,
      failureClass: "identity_mapping_unavailable",
    });
    expect(await t.run((ctx) => ctx.db.get(jobId))).toMatchObject({
      status: "parsing",
    });
    await expect(
      t.mutation(internal.dataImport.reserveJob, {
        userId: "import-test",
        mode: "archive",
        fileName: "retry.zip",
        fileSize: 128,
        fileLastModified: 0,
        sourceKey,
        uploadExpiresAt: Date.now() + 60_000,
      })
    ).rejects.toThrow("An import is already active");
    expect(await t.run((ctx) => ctx.db.query("cards").collect())).toEqual([]);
    const item = await t.run((ctx) => ctx.db.get(itemId));
    expect(item).toMatchObject({ status: "pending" });
    expect(item?.cardId).toBeUndefined();
    await t.mutation(internal.dataImport.finishJob, {
      jobId,
      status: "failed",
      reportKey: "users/import-test/imports/job/report.json",
      failureClass: "identity_mapping_unavailable",
    });
    expect(await t.run((ctx) => ctx.db.get(jobId))).toMatchObject({
      status: "failed",
      failureClass: "identity_mapping_unavailable",
      reportKey: "users/import-test/imports/job/report.json",
      completedAt: expect.any(Number),
    });
  });
  test("binds a legacy job once and rejects a different version on replay", async () => {
    const { t, jobId } = await setup();
    await t.run((ctx) => ctx.db.patch(jobId, { sourceEtag: undefined }));
    expect(
      await t.mutation(internal["import/sourceVersion"].bind, {
        jobId,
        sourceEtag: '"first"',
      })
    ).toBe('"first"');
    expect(
      await t.mutation(internal["import/sourceVersion"].bind, {
        jobId,
        sourceEtag: '"first"',
      })
    ).toBe('"first"');
    await expect(
      t.mutation(internal["import/sourceVersion"].bind, {
        jobId,
        sourceEtag: '"replacement"',
      })
    ).rejects.toThrow("source_changed");
    expect(await t.run((ctx) => ctx.db.get(jobId))).toMatchObject({
      sourceEtag: '"first"',
    });
  });
  test("replayed item pages keep their counts and a URL repeated across pages is skipped", async () => {
    const { t, jobId } = await setup();
    const first = [
      {
        sourceIndex: 0,
        status: "pending" as const,
        type: "link" as const,
        content: "First",
        url: "https://example.com",
      },
      {
        sourceIndex: 1,
        status: "failed" as const,
        type: "text" as const,
        content: "Invalid",
        failureCode: "INVALID_ITEM",
        failureReason: "Unsupported card type",
      },
    ];
    await t.mutation(internal.dataImport.insertItems, { jobId, items: first });
    await t.mutation(internal.dataImport.insertItems, { jobId, items: first });
    await t.mutation(internal.dataImport.insertItems, {
      jobId,
      items: [
        {
          sourceIndex: 2,
          status: "pending",
          type: "link",
          content: "Duplicate",
          url: "https://example.com",
        },
      ],
    });
    expect(await t.run((ctx) => ctx.db.get(jobId))).toMatchObject({
      parsedCount: 3,
      processedCount: 2,
      skippedCount: 1,
      failedCount: 1,
    });
    const items = await t.run((ctx) =>
      ctx.db
        .query("importJobItems")
        .withIndex("by_job_source", (q) => q.eq("jobId", jobId))
        .take(10)
    );
    expect(items.map((item) => item.status)).toEqual([
      "pending",
      "failed",
      "skipped",
    ]);
    expect(items[2]).toMatchObject({ failureCode: "SOURCE_DUPLICATE" });
  });
});
