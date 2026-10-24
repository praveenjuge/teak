import rateLimiterTest from "@convex-dev/rate-limiter/test";
import workosTest from "@convex-dev/workos-authkit/test";
import { getFunctionName } from "convex/server";
import { convexTest } from "convex-test";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  convexForWorker,
  loadFilesWorker,
} from "../__tests__/helpers/filesWorker.test-utils";
import { seedWorkosOwner } from "../__tests__/helpers/workosOwner.test-utils";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { insertCompletedCards } from "../card/defaultCards";
import schema from "../schema";
import { buildR2UserPrefix } from "../storage/r2";

vi.mock("@resvg/resvg-wasm/index_bg.wasm", () => ({ default: null }));
const filesWorker = await loadFilesWorker();
const modules = import.meta.glob("../**/*.ts");
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
  test("one page listed under two addresses in a file is imported once", async () => {
    const { t, jobId } = await setup();
    const link = (sourceIndex: number, url: string) => ({
      sourceIndex,
      status: "pending" as const,
      type: "link" as const,
      content: url,
      url,
    });
    await t.mutation(internal.dataImport.insertItems, {
      jobId,
      items: [
        link(0, "https://www.example.com/post/"),
        link(1, "http://example.com/post?utm_source=x#top"),
        link(2, "https://example.com/post?id=2"),
        link(3, "https://example.com/saved?fbclid=1"),
      ],
    });
    // An item staged before `urlKey` existed matches by its exact address.
    await t.run((ctx) =>
      ctx.db.insert("importJobItems", {
        jobId,
        userId: "import-test",
        sourceIndex: 4,
        status: "pending",
        type: "link",
        content: "Old",
        url: "https://example.com/old",
        createdAt: 0,
        updatedAt: 0,
      })
    );
    await t.mutation(internal.dataImport.insertItems, {
      jobId,
      items: [link(5, "https://example.com/old")],
    });
    const items = await t.run((ctx) =>
      ctx.db
        .query("importJobItems")
        .withIndex("by_job_source", (q) => q.eq("jobId", jobId))
        .take(10)
    );
    expect(items.map((item) => [item.sourceIndex, item.failureCode])).toEqual([
      [0, undefined],
      [1, "SOURCE_DUPLICATE"],
      [2, undefined],
      [3, undefined],
      [4, undefined],
      [5, "SOURCE_DUPLICATE"],
    ]);
  });
});

// One archive with every outcome an item can have: created (text, link,
// file, Markdown), skipped within a page, across pages and against an
// existing card, and failed as invalid or as unreadable Markdown. The
// padded fillers (an ignored field just under the 1 MiB string limit) push
// the last three items onto a second 4 MiB source page.
const stagingArchive = () =>
  zipSync(
    {
      "manifest.json": strToU8(
        JSON.stringify({
          version: 1,
          cards: [
            { content: "A note", type: "text", tags: ["kept"] },
            { content: "Example", type: "link", url: "https://example.com/a" },
            { content: "Again", type: "link", url: "https://example.com/a" },
            { content: "Broken", type: "not-a-type" },
            {
              content: "",
              type: "document",
              file: {
                fileName: "paper.pdf",
                mimeType: "application/pdf",
                path: "files/paper.pdf",
              },
            },
            {
              content: "",
              type: "document",
              file: {
                fileName: "notes.md",
                mimeType: "text/markdown",
                path: "files/notes.md",
              },
            },
            {
              content: "",
              type: "document",
              file: {
                fileName: "garbled.md",
                mimeType: "text/markdown",
                path: "files/garbled.md",
              },
            },
            { content: "Known", type: "link", url: "https://exists.example/" },
            ...Array.from({ length: 5 }, (_, index) => ({
              content: `Filler ${index}`,
              type: "text",
              folders: ["Imported"],
              padding: "x".repeat(900_000),
            })),
            { content: "Late", type: "link", url: "https://example.com/a" },
            { content: "Last", type: "text" },
          ],
        })
      ),
      "files/paper.pdf": strToU8("%PDF-1.4 fake"),
      "files/notes.md": strToU8("# Notes"),
      "files/garbled.md": new Uint8Array([0xff, 0xfe, 0xfd]),
    },
    { level: 0 }
  );

describe("imports staged in R2", () => {
  const stagingSetup = () => {
    vi.stubEnv("IDENTITY_RESOLVER_ENFORCE", "false");
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t, "rateLimiterV2");
    workosTest.register(t);
    const bucket = new filesWorker.FakeBucket();
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
    const archive = stagingArchive();
    const startJob = async (userId: string, staged: boolean) => {
      const workosUserId = await seedWorkosOwner(t, userId);
      await t.run((ctx) =>
        insertCompletedCards(ctx, userId, [
          { type: "link", content: "Existing", url: "https://exists.example/" },
        ])
      );
      const source = `${buildR2UserPrefix(userId)}/upload-pending-v2/import-source/source.zip`;
      await bucket.put(source, archive);
      const jobId = await t.mutation(internal.dataImport.reserveJob, {
        userId,
        mode: "archive",
        fileName: "teak-export.zip",
        fileSize: archive.length,
        fileLastModified: 0,
        sourceKey: source,
        uploadExpiresAt: Date.now() + 60_000,
      });
      await t.run((ctx) =>
        ctx.db.patch(jobId, {
          status: "queued",
          uploadId: undefined,
          ...(staged
            ? {
                stagedItems: {
                  pages: 0,
                  parts: 0,
                  cursor: 0,
                  part: 1,
                  offset: 0,
                },
              }
            : {}),
        })
      );
      return {
        jobId,
        signed: t.withIdentity({
          issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
          subject: workosUserId,
          sid: `session_${Buffer.from(userId).toString("hex")}`,
          email_verified: true,
          external_id: userId,
        }),
      };
    };
    const runJob = (jobId: string, convex = convexForWorker(t)) =>
      filesWorker.runImport(
        {
          env,
          instanceId: `import-${jobId}`,
          params: { jobId, convexSiteUrl: "https://session-tests.convex.site" },
          step: filesWorker.createFakeStep().step,
        },
        { convex, ops: (spec: unknown) => filesWorker.callFilesOp(env, spec) }
      );
    // What the person sees of a finished import.
    const outcome = async (
      userId: string,
      jobId: Id<"importJobs">,
      signed: ReturnType<typeof t.withIdentity>
    ) => {
      const job = await t.run((ctx) => ctx.db.get(jobId));
      const cards = await t.run((ctx) =>
        ctx.db
          .query("cards")
          .withIndex("by_user_deleted_saved", (q) => q.eq("userId", userId))
          .collect()
      );
      return {
        latest: await signed.query(api.dataImport.getLatestImport, {}),
        samples: await signed.query(api.dataImport.getImportFailureSamples, {
          jobId,
        }),
        report: new TextDecoder().decode(
          bucket.storedBytes(job?.reportKey as string) as Uint8Array
        ),
        cards: cards
          .map((card) => ({
            content: card.content,
            type: card.type,
            url: card.url,
            tags: card.tags,
            folders: card.folderIds?.length ?? 0,
            file: card.fileKey
              ? new TextDecoder().decode(
                  bucket.storedBytes(card.fileKey) as Uint8Array
                )
              : undefined,
          }))
          .sort((a, b) =>
            `${a.content}${a.url}`.localeCompare(`${b.content}${b.url}`)
          ),
      };
    };
    return { t, bucket, deleted, startJob, runJob, outcome };
  };

  const comparable = (seen: {
    latest: Record<string, unknown> | null;
    samples: unknown;
    report: string;
    cards: unknown;
  }) => {
    const { id, createdAt, updatedAt, completedAt, ...latest } =
      seen.latest ?? {};
    return { ...seen, latest };
  };

  test.each([{ lostAnswers: false }, { lostAnswers: true }])(
    "an import staged in R2 ends exactly like one staged in rows (lost Convex answers: $lostAnswers)",
    async ({ lostAnswers }) => {
      const { t, bucket, deleted, startJob, runJob, outcome } = stagingSetup();
      const rows = await startJob("rows-owner", false);
      const staged = await startJob("staged-owner", true);

      await runJob(rows.jobId);
      const lost = new Set<string>();
      const base = convexForWorker(t);
      // Each staging mutation's first answer is lost after it committed.
      await runJob(
        staged.jobId,
        lostAnswers
          ? {
              ...base,
              mutation: async (ref, args) => {
                const result = await base.mutation(ref, args);
                const name = getFunctionName(ref as never);
                if (name.startsWith("import/staging:") && !lost.has(name)) {
                  lost.add(name);
                  throw new Error(`convex_rpc_unavailable:${name}:503`);
                }
                return result;
              },
            }
          : base
      );

      const expected = await outcome("rows-owner", rows.jobId, rows.signed);
      expect(expected.latest).toMatchObject({
        status: "completed",
        parsedCount: 15,
        processedCount: 15,
        createdCount: 10,
        skippedCount: 3,
        failedCount: 2,
        reportAvailable: true,
      });
      expect(expected.samples).toMatchObject([
        { sourceIndex: 3, item: "Broken" },
        { sourceIndex: 6, item: "garbled.md" },
      ]);
      const seen = await outcome("staged-owner", staged.jobId, staged.signed);
      expect(comparable(seen)).toEqual(comparable(expected));
      if (lostAnswers) {
        expect([...lost].sort()).toEqual([
          "import/staging:createBatch",
          "import/staging:recordFailures",
          "import/staging:recordPage",
        ]);
      }

      const stagedJob = await t.run((ctx) =>
        ctx.db.get("importJobs", staged.jobId)
      );
      expect(stagedJob?.stagedItems).toMatchObject({
        pages: 2,
        parts: 2,
        cursor: null,
      });
      const partKeys = [1, 2].map(
        (part) =>
          `${buildR2UserPrefix("staged-owner")}/imports/${staged.jobId}/staged/${part}.json`
      );
      for (const key of partKeys) {
        expect(bucket.storedBytes(key)).not.toBeNull();
        expect(deleted).toContain(key);
      }
      // Convex keeps only the failed items of the staged import.
      const itemStatuses = async (jobId: Id<"importJobs">) =>
        (
          await t.run((ctx) =>
            ctx.db
              .query("importJobItems")
              .withIndex("by_job_source", (q) => q.eq("jobId", jobId))
              .collect()
          )
        ).map((item) => item.status);
      expect(await itemStatuses(staged.jobId)).toEqual(["failed", "failed"]);
      expect(await itemStatuses(rows.jobId)).toHaveLength(15);
    },
    240_000
  );

  test("cleaning up a finished staged import deletes its staged parts", async () => {
    const { t, startJob } = stagingSetup();
    const { jobId } = await startJob("cleanup-owner", true);
    await t.run((ctx) =>
      ctx.db.patch(jobId, {
        status: "failed",
        stagedItems: { pages: 2, parts: 2, cursor: null, part: 1, offset: 0 },
      })
    );

    await t.action(internal["import/runImport"].cleanupImportJob, { jobId });

    const prefix = buildR2UserPrefix("cleanup-owner");
    const queued = (
      await t.run((ctx) => ctx.db.query("workflowDispatches").collect())
    ).flatMap((row) => row.keys ?? []);
    expect(queued).toEqual(
      expect.arrayContaining([
        `${prefix}/imports/${jobId}/staged/1.json`,
        `${prefix}/imports/${jobId}/staged/2.json`,
      ])
    );
    expect(await t.run((ctx) => ctx.db.get(jobId))).toBeNull();
  });
});
