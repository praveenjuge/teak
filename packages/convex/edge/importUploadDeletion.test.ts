import betterAuthTest from "@convex-dev/better-auth/test";
import apiKeysTest from "@vllnt/convex-api-keys/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  convexForWorker,
  loadCoreWorker,
} from "../__tests__/helpers/coreWorker.test-utils";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

vi.mock("@resvg/resvg-wasm/index_bg.wasm", () => ({ default: null }));
const coreWorker = await loadCoreWorker();
const { FakeBucket, withObjectGates, worker } = coreWorker;
const modules = import.meta.glob("../**/*.ts");
const drainImports = (
  t: ReturnType<typeof convexTest>,
  env: Record<string, unknown>,
  stateId: Id<"accountDeletionStates">
): Promise<boolean> =>
  coreWorker.drainStorageBatch(
    {
      convex: convexForWorker(t),
      ops: (spec: unknown) => coreWorker.callFilesOp(env, spec),
    },
    { stateId, generation: 1 },
    "imports"
  );

const ownerId = "import-deletion-owner";
const key = "users/import-deletion-owner/imports/proof/source.zip";
beforeEach(() => {
  vi.useFakeTimers();
  // Node requires duplex for a streamed request body; workerd does not.
  const NativeRequest = Request;
  vi.stubGlobal(
    "Request",
    class extends NativeRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        super(input, { ...init, duplex: "half" } as RequestInit);
      }
    }
  );
  vi.stubEnv("WORKOS_CLIENT_ID", "client_IMPORT");
  vi.stubEnv("WORKOS_API_KEY", "test-import-deletion-key");
  vi.stubEnv("IDENTITY_RESOLVER_ENFORCE", "false");
  vi.stubEnv("FILES_BASE", "https://files.test");
  vi.stubEnv("FILES_SIGNING_SECRET", "test-import-signing-value");
  vi.stubEnv("R2_KEY_PREFIX", "");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test("deletion retains its source and state while an authenticated import completion is in flight", async () => {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t);
  apiKeysTest.register(t);
  await t.run((ctx) =>
    ctx.db.insert("users", {
      teakUserId: ownerId,
      workosUserId: "user_IMPORT",
      email: "import@example.com",
      emailVerified: true,
    })
  );
  const signed = t.withIdentity({
    issuer: "https://api.workos.com/user_management/client_IMPORT",
    subject: "user_IMPORT",
    sid: "session_IMPORT",
    email_verified: true,
    external_id: ownerId,
  });
  const bucket = new FakeBucket();
  const upload = bucket.createMultipartUpload(key);
  await upload.uploadPart(1, new Uint8Array([1]));
  const jobId = await t.run((ctx) =>
    ctx.db.insert("importJobs", {
      userId: ownerId,
      sourceKey: key,
      uploadId: upload.uploadId,
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
      cancelRequested: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  );
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  let admitted!: () => void;
  const admission = new Promise<void>((resolve) => {
    admitted = resolve;
  });
  const complete = async () => {
    admitted();
    await hold;
    return upload.complete([{ partNumber: 1 }]);
  };
  const resume = bucket.resumeMultipartUpload.bind(bucket);
  bucket.resumeMultipartUpload = (uploadKey: string, uploadId: string) => ({
    ...resume(uploadKey, uploadId),
    complete,
  });
  const env = withObjectGates({
    BUCKET: bucket,
    FILES_SIGNING_SECRET: "test-import-signing-value",
  });
  vi.stubGlobal(
    "fetch",
    (input: string | URL | Request, init?: RequestInit) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      expect(new URL(request.url).origin).toBe("https://files.test");
      return worker.fetch(request, env, {
        waitUntil: () => undefined,
      } as never);
    }
  );
  const completion = signed
    .action(api.importUpload.completeImportUpload, { jobId })
    .catch((error: unknown) => error);
  await admission;
  await signed.mutation(api.accountDeletion.deleteMyAccount, {});
  const state = await t.run((ctx) =>
    ctx.db.query("accountDeletionStates").unique()
  );
  if (!state) {
    throw new Error("Expected durable deletion state");
  }
  await t.run((ctx) =>
    ctx.db.patch(state._id, { stage: 3, writersPrepared: true })
  );
  try {
    await expect(drainImports(t, env, state._id)).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.get(jobId))).not.toBeNull();
    expect(await t.run((ctx) => ctx.db.get(state._id))).toMatchObject({
      stage: 3,
    });
  } finally {
    release();
    expect(await completion).toBeInstanceOf(Error);
  }
});

async function importSession() {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t);
  apiKeysTest.register(t);
  await t.run((ctx) =>
    ctx.db.insert("users", {
      teakUserId: ownerId,
      workosUserId: "user_IMPORT",
      email: "import@example.com",
      emailVerified: true,
    })
  );
  const signed = t.withIdentity({
    issuer: "https://api.workos.com/user_management/client_IMPORT",
    subject: "user_IMPORT",
    sid: "session_IMPORT",
    email_verified: true,
    external_id: ownerId,
  });

  return { t, signed };
}

test("multipart creation that overlaps deletion stays captured until freeze can abort it", async () => {
  const { t, signed } = await importSession();
  const bucket = new FakeBucket();
  const create = bucket.createMultipartUpload.bind(bucket);
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  let admit!: () => void;
  const admitted = new Promise<void>((resolve) => {
    admit = resolve;
  });
  bucket.createMultipartUpload = (async (
    ...args: [string, Record<string, unknown>?]
  ) => {
    const upload = create(...args);
    admit();
    await hold;
    return upload;
  }) as unknown as typeof bucket.createMultipartUpload;
  const env = withObjectGates({
    BUCKET: bucket,
    FILES_SIGNING_SECRET: "test-import-signing-value",
  });
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) =>
    worker.fetch(
      input instanceof Request ? input : new Request(input, init),
      env,
      { waitUntil: () => undefined } as never
    )
  );
  const creating = signed
    .action(api.importUpload.createImportUpload, {
      mode: "archive",
      fileName: "proof.zip",
      fileSize: 1,
      fileLastModified: 0,
    })
    .catch((error: unknown) => error);
  await admitted;
  await signed.mutation(api.accountDeletion.deleteMyAccount, {});
  const state = await t.run((ctx) =>
    ctx.db.query("accountDeletionStates").unique()
  );
  if (!state) {
    throw new Error("Missing deletion state");
  }
  await t.run((ctx) =>
    ctx.db.patch(state._id, { stage: 3, writersPrepared: true })
  );
  try {
    await expect(drainImports(t, env, state._id)).rejects.toThrow();
    expect(
      await t.run((ctx) => ctx.db.query("importJobs").unique())
    ).not.toBeNull();
  } finally {
    release();
  }
  expect(await creating).toBeInstanceOf(Error);
  await drainImports(t, env, state._id);
  expect(bucket.multipartUploads.size).toBe(0);
});

test("five GiB imports retain eighty size-bound Worker parts and resumable uploads use the same gate", async () => {
  const { t, signed } = await importSession();
  const bucket = new FakeBucket();
  const env = withObjectGates({
    BUCKET: bucket,
    FILES_SIGNING_SECRET: "test-import-signing-value",
  });
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) =>
    worker.fetch(
      input instanceof Request ? input : new Request(input, init),
      env,
      { waitUntil: () => undefined } as never
    )
  );
  const file = {
    fileName: "proof.zip",
    fileSize: 5 * 1024 * 1024 * 1024,
    fileLastModified: 0,
  };
  const created = await signed.action(api.importUpload.createImportUpload, {
    ...file,
    mode: "archive",
  });
  expect(created.parts).toHaveLength(80);
  expect(created.partSize).toBe(64 * 1024 * 1024);
  expect(new URL(created.parts[79].url).searchParams.get("sz")).toBe(
    String(created.partSize)
  );
  const resumed = await signed.action(
    api.importUpload.resumeImportUpload,
    file
  );
  expect(resumed.parts).toHaveLength(80);
  expect(resumed.parts[79]).toEqual(created.parts[79]);
  await signed.mutation(api.accountDeletion.deleteMyAccount, {});
  const state = await t.run((ctx) =>
    ctx.db.query("accountDeletionStates").unique()
  );
  if (!state) {
    throw new Error("Missing deletion state");
  }
  await t.run((ctx) =>
    ctx.db.patch(state._id, { stage: 3, writersPrepared: true })
  );
  await drainImports(t, env, state._id);
  expect(bucket.multipartUploads.size).toBe(0);
  await expect(
    signed.action(api.importUpload.resumeImportUpload, file)
  ).rejects.toThrow();
  const stale = await worker.fetch(
    new Request(created.parts[0].url, {
      method: "PUT",
      body: new Blob([new Uint8Array(created.partSize)]),
      headers: { "content-length": String(created.partSize) },
    }),
    env,
    { waitUntil: () => undefined } as never
  );
  expect(stale.status).toBe(409);
});

function stubWorker() {
  const bucket = new FakeBucket();
  const env = withObjectGates({
    BUCKET: bucket,
    FILES_SIGNING_SECRET: "test-import-signing-value",
  });
  const call = (request: Request) =>
    worker.fetch(request, env, { waitUntil: () => undefined } as never);
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) =>
    call(input instanceof Request ? input : new Request(input, init))
  );
  return { bucket, call };
}

const putPart = (
  call: (request: Request) => Promise<Response>,
  url: string,
  bytes: Uint8Array<ArrayBuffer>
) =>
  call(
    new Request(url, {
      method: "PUT",
      body: new Blob([bytes]),
      headers: { "content-length": String(bytes.byteLength) },
    })
  );

test("completion hands the client-recorded part ETags to R2 and queues the import", async () => {
  const { t, signed } = await importSession();
  const { bucket, call } = stubWorker();
  const created = await signed.action(api.importUpload.createImportUpload, {
    mode: "archive",
    fileName: "proof.zip",
    fileSize: 1,
    fileLastModified: 0,
  });
  const resume = bucket.resumeMultipartUpload.bind(bucket);
  bucket.resumeMultipartUpload = (objectKey: string, uploadId: string) => {
    const upload = resume(objectKey, uploadId);
    return {
      ...upload,
      complete: (parts: Array<{ partNumber: number; etag: string }>) => {
        if (parts[0].etag !== "etag-1") {
          return Promise.reject(new Error("R2 part ETag mismatch"));
        }
        return upload.complete(parts);
      },
    };
  };
  const put = await putPart(call, created.parts[0].url, new Uint8Array([1]));
  expect(put.status).toBe(204);
  await signed.mutation(api.dataImport.recordImportPart, {
    jobId: created.jobId,
    partNumber: 1,
    etag: `"${put.headers.get("etag")}"`,
    size: 1,
  });
  await signed.action(api.importUpload.completeImportUpload, {
    jobId: created.jobId,
  });
  const job = await t.run((ctx) =>
    ctx.db.get(created.jobId as Id<"importJobs">)
  );
  expect(job).toMatchObject({ status: "queued" });
  expect(job?.uploadedParts).toBeUndefined();
  expect(bucket.multipartCompletions[0].bytes).toEqual(new Uint8Array([1]));
});

test("completion refuses an upload whose parts were never recorded", async () => {
  const { signed } = await importSession();
  const { bucket, call } = stubWorker();
  const created = await signed.action(api.importUpload.createImportUpload, {
    mode: "archive",
    fileName: "proof.zip",
    fileSize: 1,
    fileLastModified: 0,
  });
  expect(
    (await putPart(call, created.parts[0].url, new Uint8Array([1]))).status
  ).toBe(204);
  await expect(
    signed.action(api.importUpload.completeImportUpload, {
      jobId: created.jobId,
    })
  ).rejects.toThrow("Not all upload parts are present");
  expect(bucket.multipartCompletions).toHaveLength(0);
});

test("resume signs only the parts that were not recorded", async () => {
  const { signed } = await importSession();
  stubWorker();
  const partSize = 64 * 1024 * 1024;
  const file = {
    fileName: "proof.zip",
    fileSize: partSize * 2 + 5,
    fileLastModified: 0,
  };
  const created = await signed.action(api.importUpload.createImportUpload, {
    ...file,
    mode: "archive",
  });
  expect(
    created.parts.map((part: { partNumber: number }) => part.partNumber)
  ).toEqual([1, 2, 3]);
  await signed.mutation(api.dataImport.recordImportPart, {
    jobId: created.jobId,
    partNumber: 2,
    etag: "etag-2",
    size: partSize,
  });
  const resumed = await signed.action(
    api.importUpload.resumeImportUpload,
    file
  );
  expect(resumed.uploadedParts).toEqual([2]);
  expect(
    resumed.parts.map((part: { partNumber: number }) => part.partNumber)
  ).toEqual([1, 3]);
});

test.each([
  { name: "a part number past the end", partNumber: 4, size: 5 },
  { name: "a final part with the wrong size", partNumber: 3, size: 6 },
  { name: "a middle part shorter than the part size", partNumber: 1, size: 5 },
])("recording rejects $name", async ({ partNumber, size }) => {
  const { t, signed } = await importSession();
  stubWorker();
  const created = await signed.action(api.importUpload.createImportUpload, {
    mode: "archive",
    fileName: "proof.zip",
    fileSize: 64 * 1024 * 1024 * 2 + 5,
    fileLastModified: 0,
  });
  await expect(
    signed.mutation(api.dataImport.recordImportPart, {
      jobId: created.jobId,
      partNumber,
      etag: "etag-x",
      size,
    })
  ).rejects.toThrow("Uploaded part metadata is invalid");
  expect(
    (await t.run((ctx) => ctx.db.get(created.jobId as Id<"importJobs">)))
      ?.uploadedParts
  ).toBeUndefined();
});

test("recording accepts the long opaque part ETags local R2 returns", async () => {
  const { t, signed } = await importSession();
  stubWorker();
  const created = await signed.action(api.importUpload.createImportUpload, {
    mode: "archive",
    fileName: "proof.zip",
    fileSize: 1,
    fileLastModified: 0,
  });
  const etag = `"${"bSnn2_2AdLF8c-0H2i9IX".repeat(8)}"`;
  await signed.mutation(api.dataImport.recordImportPart, {
    jobId: created.jobId,
    partNumber: 1,
    etag,
    size: 1,
  });
  expect(
    (await t.run((ctx) => ctx.db.get(created.jobId as Id<"importJobs">)))
      ?.uploadedParts
  ).toEqual([{ partNumber: 1, etag: etag.slice(1, -1), size: 1 }]);
});

test("another user cannot record parts on someone else's import", async () => {
  const { t, signed } = await importSession();
  stubWorker();
  const created = await signed.action(api.importUpload.createImportUpload, {
    mode: "archive",
    fileName: "proof.zip",
    fileSize: 1,
    fileLastModified: 0,
  });
  await t.run((ctx) =>
    ctx.db.insert("users", {
      teakUserId: "import-intruder",
      workosUserId: "user_INTRUDER",
      email: "intruder@example.com",
      emailVerified: true,
    })
  );
  const intruder = t.withIdentity({
    issuer: "https://api.workos.com/user_management/client_IMPORT",
    subject: "user_INTRUDER",
    sid: "session_INTRUDER",
    email_verified: true,
    external_id: "import-intruder",
  });
  await expect(
    intruder.mutation(api.dataImport.recordImportPart, {
      jobId: created.jobId,
      partNumber: 1,
      etag: "etag-1",
      size: 1,
    })
  ).rejects.toThrow("Import upload not found");
});

test("the import report downloads through the core worker as an attachment", async () => {
  const { t, signed } = await importSession();
  const { bucket, call } = stubWorker();
  const reportKey = "users/import-deletion-owner/imports/proof/report.txt";
  await bucket.put(reportKey, new TextEncoder().encode("row 3: bad url\n"));
  const jobId = await t.mutation(internal.dataImport.reserveJob, {
    userId: ownerId,
    mode: "archive",
    fileName: "proof.zip",
    fileSize: 1,
    fileLastModified: 0,
    sourceKey: key,
    uploadExpiresAt: Date.now() + 86_400_000,
  });
  await t.run((ctx) => ctx.db.patch(jobId, { reportKey }));
  const url = await signed.action(api.importUpload.getImportReportUrl, {
    jobId,
  });
  expect(new URL(url).origin).toBe("https://files.test");
  const response = await call(new Request(url));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-disposition")).toBe(
    'attachment; filename="teak-import-report.txt"'
  );
  expect(response.headers.get("content-type")).toBe(
    "text/plain; charset=utf-8"
  );
  expect(await response.text()).toBe("row 3: bad url\n");
});

test.each(["cancel", "items", "job", "cleanup action"] as const)(
  "late import %s mutations preserve captured deletion evidence",
  async (operation) => {
    const { t, signed } = await importSession();
    const jobId = await t.mutation(internal.dataImport.reserveJob, {
      userId: ownerId,
      mode: "archive",
      fileName: "proof.zip",
      fileSize: 1,
      fileLastModified: 0,
      sourceKey: key,
      uploadExpiresAt: Date.now() + 86_400_000,
    });
    const itemId = await t.run((ctx) =>
      ctx.db.insert("importJobItems", {
        jobId,
        userId: ownerId,
        sourceIndex: 0,
        status: "failed",
        type: "text",
        content: "proof",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    );
    await signed.mutation(api.accountDeletion.deleteMyAccount, {});
    const state = await t.run((ctx) =>
      ctx.db.query("accountDeletionStates").unique()
    );
    if (!state) {
      throw new Error("Missing deletion state");
    }
    await t.run((ctx) =>
      ctx.db.patch(state._id, { stage: 3, writersPrepared: true })
    );
    const binding = {
      stateId: state._id,
      generation: 1,
      kind: "imports" as const,
    };
    const original = await t.mutation(
      internal.accountDeletionData.prepareStorageBatch,
      binding
    );
    let mutation: Promise<unknown>;
    if (operation === "cancel") {
      mutation = t.mutation(internal.dataImport.markCancelRequested, {
        jobId,
        userId: ownerId,
      });
    } else if (operation === "items") {
      mutation = t.mutation(internal.dataImport.deleteItemsPage, {
        jobId,
        limit: 200,
      });
    } else if (operation === "job") {
      mutation = t.mutation(internal.dataImport.deleteJob, { jobId });
    } else {
      mutation = t.action(internal["import/runImport"].cleanupImportJob, {
        jobId,
      });
    }
    await expect(mutation).rejects.toThrow(
      "Account deletion is already in progress"
    );
    expect(await t.run((ctx) => ctx.db.get(jobId))).not.toBeNull();
    expect(await t.run((ctx) => ctx.db.get(itemId))).not.toBeNull();
    expect(
      await t.mutation(
        internal.accountDeletionData.prepareStorageBatch,
        binding
      )
    ).toEqual(original);
  }
);

test("ordinary import cancellation and obsolete job cleanup remain available", async () => {
  const { t } = await importSession();
  const jobId = await t.mutation(internal.dataImport.reserveJob, {
    userId: ownerId,
    mode: "archive",
    fileName: "proof.zip",
    fileSize: 1,
    fileLastModified: 0,
    sourceKey: key,
    uploadExpiresAt: Date.now() + 86_400_000,
  });
  const itemId = await t.run((ctx) =>
    ctx.db.insert("importJobItems", {
      jobId,
      userId: ownerId,
      sourceIndex: 0,
      status: "failed",
      type: "text",
      content: "proof",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  );
  expect(
    await t.mutation(internal.dataImport.markCancelRequested, {
      jobId,
      userId: ownerId,
    })
  ).toMatchObject({ active: true });
  expect(
    await t.mutation(internal.dataImport.deleteItemsPage, { jobId, limit: 200 })
  ).toEqual({ count: 1 });
  await t.mutation(internal.dataImport.deleteJob, { jobId });
  expect(await t.run((ctx) => ctx.db.get(jobId))).toBeNull();
  expect(await t.run((ctx) => ctx.db.get(itemId))).toBeNull();
});

test("orphan import items still retain their owner's deletion fence", async () => {
  const { t, signed } = await importSession();
  const jobId = await t.mutation(internal.dataImport.reserveJob, {
    userId: ownerId,
    mode: "archive",
    fileName: "proof.zip",
    fileSize: 1,
    fileLastModified: 0,
    sourceKey: key,
    uploadExpiresAt: Date.now() + 86_400_000,
  });
  const itemId = await t.run((ctx) =>
    ctx.db.insert("importJobItems", {
      jobId,
      userId: ownerId,
      sourceIndex: 0,
      status: "failed",
      type: "text",
      content: "proof",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  );
  await t.mutation(internal.dataImport.deleteJob, { jobId });
  await signed.mutation(api.accountDeletion.deleteMyAccount, {});
  await expect(
    t.mutation(internal.dataImport.deleteItemsPage, { jobId, limit: 200 })
  ).rejects.toThrow("Account deletion is already in progress");
  expect(await t.run((ctx) => ctx.db.get(itemId))).not.toBeNull();
});

test("the hourly cron aborts an abandoned import upload, fails the job and queues its source for deletion", async () => {
  const { t } = await importSession();
  const bucket = new FakeBucket();
  const upload = bucket.createMultipartUpload(key);
  const reserve = (userId: string, sourceKey: string, expiresIn: number) =>
    t.mutation(internal.dataImport.reserveJob, {
      userId,
      mode: "archive",
      fileName: "proof.zip",
      fileSize: 1,
      fileLastModified: 0,
      sourceKey,
      uploadExpiresAt: Date.now() + expiresIn,
    });
  const abandoned = await reserve(ownerId, key, -1);
  await t.run((ctx) => ctx.db.patch(abandoned, { uploadId: upload.uploadId }));
  const live = await reserve(
    "import-live-owner",
    "users/import-live-owner/imports/live/source.zip",
    86_400_000
  );
  const env = { BUCKET: bucket, FILES_SIGNING_SECRET: "test" };

  expect(await coreWorker.expireImportUploads(env, convexForWorker(t))).toBe(1);
  expect(await coreWorker.expireImportUploads(env, convexForWorker(t))).toBe(0);

  expect(bucket.multipartUploads.has(upload.uploadId)).toBe(false);
  const expired = await t.run((ctx) => ctx.db.get(abandoned));
  expect(expired).toMatchObject({
    status: "failed",
    failureClass: "upload_expired",
  });
  expect(expired).not.toHaveProperty("uploadId");
  expect(await t.run((ctx) => ctx.db.get(live))).toMatchObject({
    status: "uploading",
  });
  const dispatches = await t.run((ctx) =>
    ctx.db.query("workflowDispatches").collect()
  );
  expect(
    dispatches.filter((row) => row.kind === "deleteObjects")
  ).toMatchObject([{ keys: [key] }]);
});

async function uploadOnePart() {
  const session = await importSession();
  const worker = stubWorker();
  const created = await session.signed.action(
    api.importUpload.createImportUpload,
    { mode: "archive", fileName: "proof.zip", fileSize: 1, fileLastModified: 0 }
  );
  const put = await putPart(
    worker.call,
    created.parts[0].url,
    new Uint8Array([1])
  );
  await session.signed.mutation(api.dataImport.recordImportPart, {
    jobId: created.jobId,
    partNumber: 1,
    etag: `"${put.headers.get("etag")}"`,
    size: 1,
  });
  return { ...session, ...worker, jobId: created.jobId as Id<"importJobs"> };
}

interface CompletedPart {
  etag: string;
  partNumber: number;
}

test("a second completion while the first is finishing leaves the queued import's source in place", async () => {
  const { t, signed, bucket, jobId } = await uploadOnePart();
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  let admit!: () => void;
  const completedInR2 = new Promise<void>((resolve) => {
    admit = resolve;
  });
  const resume = bucket.resumeMultipartUpload.bind(bucket);
  bucket.resumeMultipartUpload = (objectKey: string, uploadId: string) => {
    const upload = resume(objectKey, uploadId);
    return {
      ...upload,
      complete: async (parts: CompletedPart[]) => {
        const result = await upload.complete(parts);
        admit();
        await hold;
        return result;
      },
    };
  };
  const first = signed.action(api.importUpload.completeImportUpload, {
    jobId,
  });
  await completedInR2;
  const sourceKey = bucket.multipartCompletions[0].key;
  try {
    await expect(
      signed.action(api.importUpload.completeImportUpload, { jobId })
    ).rejects.toThrow("This import is already being completed");
  } finally {
    release();
  }
  await first;
  expect(await t.run((ctx) => ctx.db.get(jobId))).toMatchObject({
    status: "queued",
  });
  expect(bucket.storedBytes(sourceKey)).toEqual(new Uint8Array([1]));
});

test("a completion that fails releases its claim so a retry can finish the upload", async () => {
  const { t, signed, call, jobId } = await uploadOnePart();
  let failNext = true;
  vi.stubGlobal(
    "fetch",
    (input: string | URL | Request, init?: RequestInit) => {
      if (failNext) {
        failNext = false;
        return Promise.reject(new Error("connection reset"));
      }
      return call(input instanceof Request ? input : new Request(input, init));
    }
  );
  await expect(
    signed.action(api.importUpload.completeImportUpload, { jobId })
  ).rejects.toThrow("files_worker_network_error");
  await signed.action(api.importUpload.completeImportUpload, { jobId });
  expect(await t.run((ctx) => ctx.db.get(jobId))).toMatchObject({
    status: "queued",
  });
});

test("a completion claim left by a call that died lapses so the upload can still complete", async () => {
  const { t, signed, bucket, jobId } = await uploadOnePart();
  await t.run((ctx) =>
    ctx.db.patch(jobId, {
      completionClaim: { token: "dead-call", expiresAt: Date.now() + 1000 },
    })
  );
  await expect(
    signed.action(api.importUpload.completeImportUpload, { jobId })
  ).rejects.toThrow("This import is already being completed");
  expect(bucket.multipartCompletions).toHaveLength(0);
  vi.advanceTimersByTime(1001);
  await signed.action(api.importUpload.completeImportUpload, { jobId });
  expect(await t.run((ctx) => ctx.db.get(jobId))).toMatchObject({
    status: "queued",
  });
  expect(
    (await t.run((ctx) => ctx.db.get(jobId)))?.completionClaim
  ).toBeUndefined();
});
