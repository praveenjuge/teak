/// <reference types="vite/client" />

import batchWorkerTest from "@convex-dev/batch-worker/test";
import workflowTest from "@convex-dev/workflow/test";
import workpoolTest from "@convex-dev/workpool/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const sourceKey = "users/import-test/imports/job/source.zip";
const setup = async (
  mode: "archive" | "bookmarks" = "archive",
  testModules = modules
) => {
  const t = convexTest(schema, testModules);
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
    "the $outcome workflow preserves its outcome and cleans unclaimed files (report failure: $reportFails)",
    async ({ reportFails, outcome }) => {
      vi.useFakeTimers();
      vi.stubEnv("IDENTITY_RESOLVER_ENFORCE", "true");
      // Workflow replay disables process globally; load the real step modules
      // into plain module callbacks before replay enters that environment.
      const cacheModules = async (
        sources: Record<string, () => Promise<unknown>>
      ) =>
        Object.fromEntries(
          await Promise.all(
            Object.entries(sources)
              .filter(
                ([path]) =>
                  !(
                    path.endsWith(".test.ts") ||
                    path.endsWith("convex.config.ts")
                  )
              )
              .map(async ([path, load]) => {
                const loaded = await load();
                return [path, () => Promise.resolve(loaded)] as const;
              })
          )
        );
      const rootModules = { ...modules };
      for (const path of [
        "./dataImport.ts",
        "./import/runImport.ts",
        "./workflows/import.ts",
        "./workflows/objectCleanup.ts",
        "./workflows/manager.ts",
      ]) {
        const loaded = await modules[path]();
        rootModules[path] = () => Promise.resolve(loaded);
      }
      const { t, jobId } = await setup("archive", rootModules);
      t.registerComponent(
        "workflow",
        workflowTest.schema,
        await cacheModules(workflowTest.modules)
      );
      t.registerComponent(
        "workflow/workpool",
        workpoolTest.schema,
        await cacheModules(workpoolTest.modules)
      );
      t.registerComponent(
        "workflow/workpool/batchWorker",
        batchWorkerTest.schema,
        await cacheModules(batchWorkerTest.modules)
      );
      const orphanKey = "users/import-test/imports/job/orphan.pdf";
      const ownedKey = "users/import-test/imports/job/owned.pdf";
      await t.run(async (ctx) => {
        await ctx.db.patch(jobId, {
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
      });
      let releaseReport!: () => void;
      let reportStarted!: () => void;
      const reportPending = new Promise<void>((resolve) => {
        releaseReport = resolve;
      });
      const reportReached = new Promise<void>((resolve) => {
        reportStarted = resolve;
      });
      const deleted: string[] = [];
      vi.stubGlobal("fetch", async (_url: string, request: RequestInit) => {
        if (request.method === "PUT") {
          reportStarted();
          await reportPending;
          if (reportFails) {
            return Response.json(
              {
                ok: false,
                error: { code: "INTERNAL", requestId: "report-failure" },
              },
              { status: 503 }
            );
          }
          return Response.json({ ok: true, data: { etag: "report" } });
        }
        const body = JSON.parse(String(request.body));
        if (body.op === "index-import-source") {
          return Response.json({
            ok: true,
            data: {
              sourceEtag: '"stable"',
              total: 0,
              nextCursor: null,
              items: [],
            },
          });
        }
        if (body.op === "delete-objects") {
          deleted.push(...body.params.keys);
          return Response.json({
            ok: true,
            data: { deleted: body.params.keys.length },
          });
        }
        throw new Error(`Unexpected worker operation: ${body.op}`);
      });
      await t.mutation(internal["workflows/import"].startImportWorkflow, {
        jobId,
      });
      const drained = t.finishAllScheduledFunctions(() =>
        vi.advanceTimersByTime(100)
      );
      await reportReached;
      try {
        expect(await t.run((ctx) => ctx.db.get(jobId))).toMatchObject({
          status: outcome === "canceled" ? "parsing" : "importing",
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
      } finally {
        releaseReport();
        await drained;
      }
      const finalJob = await t.run((ctx) => ctx.db.get(jobId));
      expect(finalJob).toMatchObject({
        status: outcome === "identity" ? "failed" : outcome,
        ...(reportFails
          ? {}
          : { reportKey: expect.stringContaining("error-report.txt") }),
      });
      const reportFailure = reportFails
        ? "import_finalization_failed"
        : undefined;
      expect(finalJob?.failureClass).toBe(
        outcome === "identity" ? "identity_mapping_unavailable" : reportFailure
      );
      expect(deleted).toContain(sourceKey);
      expect(deleted).toContain(orphanKey);
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
  test("preserves deduplication across pages, invalid items, Markdown conversion, and replay counts", async () => {
    const { t, jobId } = await setup();
    const requests: Array<{ op: string; params: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", (_url: string, request: RequestInit) => {
      const body = JSON.parse(String(request.body));
      requests.push(body);
      if (body.op === "read-import-markdown") {
        return Response.json({
          ok: true,
          data: { content: "# Notes", type: "text" },
        });
      }
      expect(body.params.sourceEtag).toBe('"stable"');
      const first = body.params.cursor === 0;
      return Response.json({
        ok: true,
        data: {
          sourceEtag: '"stable"',
          total: 4,
          nextCursor: first ? 1 : null,
          items: first
            ? [
                {
                  sourceIndex: 0,
                  card: {
                    type: "link",
                    url: "https://example.com",
                    content: "First",
                  },
                },
              ]
            : [
                {
                  sourceIndex: 1,
                  card: {
                    type: "link",
                    url: "https://example.com",
                    content: "Duplicate",
                  },
                },
                {
                  sourceIndex: 2,
                  card: { type: "invalid", content: "Invalid" },
                },
                {
                  sourceIndex: 3,
                  card: {
                    type: "document",
                    content: "File",
                    file: {
                      fileName: "note.md",
                      mimeType: "text/markdown",
                      path: "files/note.md",
                    },
                  },
                  file: { path: "files/note.md", uncompressedSize: 7 },
                },
              ],
        },
      });
    });
    const run = async () => {
      let result = await t.action(
        internal["import/runImport"].indexImportSource,
        { jobId }
      );
      while (result.ok && result.nextCursor !== undefined) {
        result = await t.action(
          internal["import/runImport"].indexImportSource,
          { jobId, cursor: result.nextCursor }
        );
      }
      return result;
    };
    expect(await run()).toEqual({ ok: true });
    expect(await run()).toEqual({ ok: true });
    const job = await t.run((ctx) => ctx.db.get(jobId));
    expect(job).toMatchObject({
      parsedCount: 4,
      skippedCount: 1,
      failedCount: 1,
      processedCount: 2,
    });
    const items = await t.run((ctx) =>
      ctx.db
        .query("importJobItems")
        .withIndex("by_job_source", (q) => q.eq("jobId", jobId))
        .take(10)
    );
    expect(items[1]).toMatchObject({
      status: "skipped",
      failureCode: "SOURCE_DUPLICATE",
    });
    expect(items[2]).toMatchObject({
      status: "failed",
      failureCode: "INVALID_ITEM",
    });
    expect(items[3]).toMatchObject({
      status: "pending",
      type: "text",
      content: "# Notes",
    });
    expect(items[3]).not.toHaveProperty("filePath");
    expect(items[3]).not.toHaveProperty("fileName");
    expect(
      requests.filter((request) => request.op === "read-import-markdown")
    ).toHaveLength(2);
  });
  test("stops reading further pages after cancellation", async () => {
    const { t, jobId } = await setup("bookmarks");
    const fetchMock = vi.fn(async () => {
      await t.run((ctx) => ctx.db.patch(jobId, { cancelRequested: true }));
      return Response.json({
        ok: true,
        data: {
          sourceEtag: '"stable"',
          total: 2,
          nextCursor: 1,
          items: [
            {
              sourceIndex: 0,
              card: {
                type: "link",
                content: "First",
                url: "https://example.com",
              },
            },
          ],
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(
      await t.action(internal["import/runImport"].indexImportSource, {
        jobId,
      })
    ).toEqual({ ok: true, nextCursor: 1 });
    expect(
      await t.action(internal["import/runImport"].indexImportSource, {
        jobId,
        cursor: 1,
      })
    ).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  test("rejects changed archive versions without storing a page", async () => {
    const { t, jobId } = await setup();
    vi.stubGlobal("fetch", async () =>
      Response.json(
        { ok: false, error: { code: "CONFLICT", requestId: "changed" } },
        { status: 409 }
      )
    );
    expect(
      await t.action(internal["import/runImport"].indexImportSource, {
        jobId,
      })
    ).toMatchObject({ ok: false });
    expect(
      await t.run((ctx) => ctx.db.query("importJobItems").take(1))
    ).toHaveLength(0);
  });
});
