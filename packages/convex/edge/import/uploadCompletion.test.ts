import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "../../_generated/api";
import { buildR2UserPrefix } from "../../storage/r2";
import { newBackend, signIn } from "../helpers.testUtils";

beforeEach(() => {
  vi.stubEnv("FILES_BASE", "https://files.test");
  vi.stubEnv("FILES_SIGNING_SECRET", "test-upload-signing-value");
  vi.stubEnv("R2_KEY_PREFIX", "");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test("an upload R2 completes at the wrong size has its source deleted through the outbox", async () => {
  const t = newBackend();
  const owner = await signIn(t, "upload-owner");
  const sourceKey = `${buildR2UserPrefix("upload-owner")}/imports/proof/source.zip`;
  const jobId = await t.run((ctx) =>
    ctx.db.insert("importJobs", {
      userId: "upload-owner",
      sourceKey,
      uploadId: "upload-1",
      mode: "archive",
      status: "uploading",
      phase: "Uploading",
      fileName: "source.zip",
      fileSize: 1,
      fileLastModified: 0,
      uploadedParts: [{ partNumber: 1, etag: "etag-1", size: 1 }],
      parsedCount: 0,
      processedCount: 0,
      createdCount: 0,
      skippedCount: 0,
      failedCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  );
  const ops: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((_input: unknown, init?: RequestInit) => {
      const { op } = JSON.parse(String(init?.body)) as { op: string };
      ops.push(op);
      return Response.json({
        ok: true,
        version: 1,
        requestId: "r",
        data: { etag: "whole", size: 2 },
      });
    })
  );

  await expect(
    owner.action(api.importUpload.completeImportUpload, { jobId })
  ).rejects.toThrow("Completed upload size is invalid");

  expect(ops).toEqual(["complete-multipart"]);
  const deletions = await t.run((ctx) =>
    ctx.db
      .query("workflowDispatches")
      .withIndex("by_key_and_createdAt", (q) => q.eq("key", "deleteObjects"))
      .collect()
  );
  expect(deletions.map((row) => row.keys)).toEqual([[sourceKey]]);
});
