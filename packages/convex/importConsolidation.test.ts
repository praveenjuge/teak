/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

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
});

describe("import orchestration through the worker", () => {
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

describe("import upload part receipts", () => {
  const PART_BYTES = 64 * 1024 * 1024;
  const setupUpload = async (overrides: Record<string, unknown> = {}) => {
    const t = convexTest(schema, modules);
    const jobId = await t.run((ctx) =>
      ctx.db.insert("importJobs", {
        userId: "import-test",
        mode: "archive",
        status: "uploading",
        phase: "Uploading",
        fileName: "source.zip",
        fileSize: PART_BYTES + 10,
        fileLastModified: 0,
        sourceKey,
        uploadId: "upload-1",
        uploadExpiresAt: Date.now() + 60_000,
        uploadTransport: "worker",
        uploadParts: [],
        parsedCount: 0,
        processedCount: 0,
        createdCount: 0,
        skippedCount: 0,
        failedCount: 0,
        createdAt: 0,
        updatedAt: 0,
        ...overrides,
      })
    );
    return { t, jobId };
  };

  test("records parts with exact sizes and replaces re-uploaded parts", async () => {
    const { t, jobId } = await setupUpload();
    await t.mutation(internal["import/uploadParts"].recordUploadPart, {
      jobId,
      userId: "import-test",
      partNumber: 2,
      etag: '"part-2"',
      size: 10,
    });
    await t.mutation(internal["import/uploadParts"].recordUploadPart, {
      jobId,
      userId: "import-test",
      partNumber: 1,
      etag: '"part-1"',
      size: PART_BYTES,
    });
    await t.mutation(internal["import/uploadParts"].recordUploadPart, {
      jobId,
      userId: "import-test",
      partNumber: 1,
      etag: '"part-1-retry"',
      size: PART_BYTES,
    });
    expect(await t.run((ctx) => ctx.db.get(jobId))).toMatchObject({
      uploadParts: [
        { partNumber: 1, etag: '"part-1-retry"', size: PART_BYTES },
        { partNumber: 2, etag: '"part-2"', size: 10 },
      ],
    });
  });

  test("rejects invalid part numbers, sizes, etags, and owners", async () => {
    const { t, jobId } = await setupUpload();
    const receipt = {
      jobId,
      userId: "import-test",
      partNumber: 1,
      etag: '"part-1"',
      size: PART_BYTES,
    };
    await expect(
      t.mutation(internal["import/uploadParts"].recordUploadPart, {
        ...receipt,
        partNumber: 3,
      })
    ).rejects.toThrow();
    await expect(
      t.mutation(internal["import/uploadParts"].recordUploadPart, {
        ...receipt,
        size: PART_BYTES - 1,
      })
    ).rejects.toThrow();
    await expect(
      t.mutation(internal["import/uploadParts"].recordUploadPart, {
        ...receipt,
        etag: "not an etag!!",
      })
    ).rejects.toThrow();
    await expect(
      t.mutation(internal["import/uploadParts"].recordUploadPart, {
        ...receipt,
        userId: "someone-else",
      })
    ).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.get(jobId))).toMatchObject({
      uploadParts: [],
    });
  });

  test("rejects receipts for expired or pre-cutover uploads", async () => {
    const expired = await setupUpload({ uploadExpiresAt: Date.now() - 1 });
    await expect(
      expired.t.mutation(internal["import/uploadParts"].recordUploadPart, {
        jobId: expired.jobId,
        userId: "import-test",
        partNumber: 1,
        etag: '"part-1"',
        size: PART_BYTES,
      })
    ).rejects.toThrow();
    const legacy = await setupUpload({
      uploadTransport: undefined,
      uploadParts: undefined,
    });
    await expect(
      legacy.t.mutation(internal["import/uploadParts"].recordUploadPart, {
        jobId: legacy.jobId,
        userId: "import-test",
        partNumber: 1,
        etag: '"part-1"',
        size: PART_BYTES,
      })
    ).rejects.toThrow();
  });

  test("restarts pre-cutover transport within the same job", async () => {
    const { t, jobId } = await setupUpload({
      uploadTransport: undefined,
      uploadParts: undefined,
      uploadId: "legacy-upload",
    });
    await t.mutation(internal["import/uploadParts"].restartUploadTransport, {
      jobId,
      userId: "import-test",
      uploadExpiresAt: 1234,
    });
    const restarted = await t.run((ctx) => ctx.db.get(jobId));
    expect(restarted).toMatchObject({
      status: "uploading",
      uploadTransport: "worker",
      uploadParts: [],
      uploadExpiresAt: 1234,
    });
    expect(restarted?.uploadId).toBeUndefined();
    await expect(
      t.mutation(internal["import/uploadParts"].restartUploadTransport, {
        jobId,
        userId: "someone-else",
        uploadExpiresAt: 1234,
      })
    ).rejects.toThrow("Import upload not found");
  });
});
