import { describe, expect, test } from "bun:test";
import { createConvexRpc } from "../convexRpc";
import type { FilesOpsEnv } from "../ops";
import {
  createFakeConvex,
  type FakeHandler,
  fakeConvexEnv,
  TEST_CONVEX_SITE_URL,
} from "../test/fakeConvex";
import { FakeBucket } from "../test/testsupport";
import {
  cleanUpSearchCaches,
  expireImportUploads,
  expireUploadSessions,
} from "./hourlyCleanup";

const setup = (handlers: Record<string, FakeHandler>) => {
  const bucket = new FakeBucket();
  const env = {
    ...fakeConvexEnv,
    BUCKET: bucket as unknown as R2Bucket,
  } as FilesOpsEnv;
  const fake = createFakeConvex(handlers);
  return {
    bucket,
    callsTo: fake.callsTo,
    convex: createConvexRpc(env, TEST_CONVEX_SITE_URL, fake.fetcher),
    env,
  };
};

const pages = (counts: number[], size: number) => () => {
  const deleted = counts.shift() ?? 0;
  return { deleted, hasMore: deleted === size };
};

describe("search cache cleanup", () => {
  test("drains both caches until Convex reports nothing more to delete", async () => {
    const { callsTo, convex } = setup({
      "search/relevanceCache:cleanupExpired": pages([500, 12], 500),
      "search/semanticCache:cleanupExpired": pages([500, 500, 3], 500),
    });

    expect(await cleanUpSearchCaches(convex)).toEqual({
      relevance: 512,
      semantic: 1003,
    });
    expect(callsTo("search/semanticCache:cleanupExpired")).toHaveLength(3);
  });
});

describe("abandoned import uploads", () => {
  const source = (job: string) => `users/u1/imports/${job}/source.zip`;

  test("aborts each expired upload in R2 and fails its job, and reports a job whose abort failed", async () => {
    const uploading = new Map<
      string,
      { sourceKey: string; uploadId?: string }
    >();
    const { bucket, callsTo, convex, env } = setup({
      "dataImport:expireAbandonedUpload": ({ jobId }) =>
        uploading.delete(jobId as string),
      "dataImport:findExpiredUploads": ({ limit }) =>
        [...uploading]
          .slice(0, limit as number)
          .map(([_id, job]) => ({ _id, ...job })),
    });
    const upload = bucket.createMultipartUpload(source("a"));
    uploading.set("job-a", {
      sourceKey: source("a"),
      uploadId: upload.uploadId,
    });
    uploading.set("job-b", { sourceKey: source("b"), uploadId: "gone" });
    uploading.set("job-c", { sourceKey: source("c") });

    await expect(expireImportUploads(env, convex)).rejects.toThrow(
      "Import cleanup incomplete for 1 jobs; retry required"
    );

    expect(bucket.multipartUploads.has(upload.uploadId)).toBe(false);
    expect([...uploading.keys()]).toEqual(["job-b"]);
    expect(
      callsTo("dataImport:expireAbandonedUpload").map(({ args }) => args.jobId)
    ).toEqual(["job-a", "job-c"]);
  });

  test("keeps paging while every job on a page expires", async () => {
    const uploading = new Set(
      Array.from({ length: 70 }, (_, index) => `job-${index}`)
    );
    const { convex, env } = setup({
      "dataImport:expireAbandonedUpload": ({ jobId }) =>
        uploading.delete(jobId as string),
      "dataImport:findExpiredUploads": ({ limit }) =>
        [...uploading]
          .slice(0, limit as number)
          .map((_id) => ({ _id, sourceKey: source(_id) })),
    });

    expect(await expireImportUploads(env, convex)).toBe(70);
    expect(uploading.size).toBe(0);
  });

  test("stops when Convex no longer counts a job as expired", async () => {
    const { callsTo, convex, env } = setup({
      "dataImport:expireAbandonedUpload": () => false,
      "dataImport:findExpiredUploads": ({ limit }) =>
        Array.from({ length: limit as number }, (_, index) => ({
          _id: `job-${index}`,
          sourceKey: source(`job-${index}`),
        })),
    });

    expect(await expireImportUploads(env, convex)).toBe(0);
    expect(callsTo("dataImport:findExpiredUploads")).toHaveLength(1);
  });
});

describe("expired upload sessions", () => {
  test("aborts sessions still uploading and deletes every expired session", async () => {
    const sessions = new Map<
      string,
      { sourceKey: string; status: string; uploadId: string }
    >();
    const { bucket, convex, env } = setup({
      "fileUploads:deleteSession": ({ sessionId }) => {
        sessions.delete(sessionId as string);
        return null;
      },
      "fileUploads:findExpiredSessions": ({ limit }) =>
        [...sessions]
          .slice(0, limit as number)
          .map(([_id, session]) => ({ _id, ...session })),
    });
    const key = "users/u1/cards/upload-pending-v2/a.mov";
    const upload = bucket.createMultipartUpload(key);
    sessions.set("live", {
      sourceKey: key,
      status: "uploading",
      uploadId: upload.uploadId,
    });
    sessions.set("missing", {
      sourceKey: "users/u1/cards/upload-pending-v2/b.mov",
      status: "uploading",
      uploadId: "gone",
    });
    for (let index = 0; index < 60; index += 1) {
      sessions.set(`done-${index}`, {
        sourceKey: `users/u1/cards/upload-pending-v2/${index}.mov`,
        status: "completed",
        uploadId: `finished-${index}`,
      });
    }

    expect(await expireUploadSessions(env, convex)).toBe(62);

    expect(sessions.size).toBe(0);
    expect(bucket.multipartUploads.size).toBe(0);
  });
});
