/// <reference types="vite/client" />
import betterAuthTest from "@convex-dev/better-auth/test";
import workflowTest from "@convex-dev/workflow/test";
import workosTest from "@convex-dev/workos-authkit/test";
import apiKeysTest from "@vllnt/convex-api-keys/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { seedComponentUser } from "./__tests__/helpers/workosOwner.test-utils";
import { api, internal } from "./_generated/api";
import schema from "./schema";

vi.mock("@resvg/resvg-wasm/index_bg.wasm", () => ({ default: null }));
// Runtime imports keep Cloudflare's global declarations out of backend typechecking.
const workerPath = new URL(
  "../../apps/files-worker/src/index.ts",
  import.meta.url
).pathname;
const supportPath = new URL(
  "../../apps/files-worker/src/testsupport.ts",
  import.meta.url
).pathname;
const worker = (await import(workerPath)).default;
const { FakeBucket, withObjectGates } = await import(supportPath);
const modules = import.meta.glob("./**/*.ts");
const sdk = vi.hoisted(() => ({
  send: (_command: unknown): Promise<Record<string, unknown>> =>
    Promise.reject(new Error("Unexpected S3 operation")),
}));
vi.mock("@aws-sdk/client-s3", async (original) => ({
  ...(await original<typeof import("@aws-sdk/client-s3")>()),
  S3Client: class {
    send(command: unknown) {
      return sdk.send(command);
    }
  },
}));
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
  vi.stubEnv("WORKOS_ENVIRONMENT_ID", "environment_IMPORT");
  vi.stubEnv("WORKOS_API_KEY", "test-import-deletion-key");
  vi.stubEnv("IDENTITY_RESOLVER_ENFORCE", "false");
  vi.stubEnv("FILES_BASE", "https://files.test");
  vi.stubEnv("FILES_SIGNING_SECRET", "test-import-signing-value");
  vi.stubEnv("R2_KEY_PREFIX", "");
  vi.stubEnv("R2_BUCKET", "test-only");
  vi.stubEnv("R2_ENDPOINT", "https://r2.test");
  vi.stubEnv("R2_ACCESS_KEY_ID", "test-import-access-value");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "test-import-secret-value");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// Failure modes: already admitted completion overlaps deletion; a lost R2
// completion remains unknown; newly signed/resumed parts outlive the session;
// creation completes before its job can attach the upload ID. Production gate
// markers must prevent cleanup from being certified for every admitted write.
test("deletion retains its source and state while an authenticated import completion is in flight", async () => {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t);
  workflowTest.register(t);
  apiKeysTest.register(t);
  workosTest.register(t);
  await t.run((ctx) =>
    ctx.db.insert("users", {
      teakUserId: ownerId,
      workosUserId: "user_IMPORT",
      email: "import@example.com",
      emailVerified: true,
    })
  );
  await seedComponentUser(t, {
    id: "user_IMPORT",
    email: "import@example.com",
    externalId: ownerId,
  });
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
  sdk.send = async (command) => {
    const name = command?.constructor.name;
    if (name === "ListPartsCommand") {
      return { Parts: [{ PartNumber: 1, ETag: "etag-1", Size: 1 }] };
    }
    if (name === "CompleteMultipartUploadCommand") {
      await complete();
      return {};
    }
    if (name === "HeadObjectCommand") {
      return { ContentLength: 1 };
    }
    throw new Error(`Unexpected S3 operation: ${name}`);
  };
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
    await expect(
      t.action(internal.accountDeletionData.drainStorageBatch, {
        stateId: state._id,
        generation: 1,
        kind: "imports",
      })
    ).rejects.toThrow();
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
  workflowTest.register(t);
  apiKeysTest.register(t);
  workosTest.register(t);
  await t.run((ctx) =>
    ctx.db.insert("users", {
      teakUserId: ownerId,
      workosUserId: "user_IMPORT",
      email: "import@example.com",
      emailVerified: true,
    })
  );
  await seedComponentUser(t, {
    id: "user_IMPORT",
    email: "import@example.com",
    externalId: ownerId,
  });
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
  sdk.send = (_command) =>
    Promise.reject(new Error("Direct S3 writes are forbidden"));
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
    await expect(
      t.action(internal.accountDeletionData.drainStorageBatch, {
        stateId: state._id,
        generation: 1,
        kind: "imports",
      })
    ).rejects.toThrow();
    expect(
      await t.run((ctx) => ctx.db.query("importJobs").unique())
    ).not.toBeNull();
  } finally {
    release();
  }
  expect(await creating).toBeInstanceOf(Error);
  await t.action(internal.accountDeletionData.drainStorageBatch, {
    stateId: state._id,
    generation: 1,
    kind: "imports",
  });
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
  sdk.send = (command) => {
    if (command?.constructor.name !== "ListPartsCommand") {
      return Promise.reject(new Error("Direct S3 writes are forbidden"));
    }
    return Promise.resolve({ Parts: [] });
  };
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
  await t.action(internal.accountDeletionData.drainStorageBatch, {
    stateId: state._id,
    generation: 1,
    kind: "imports",
  });
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

test("completion uses canonical R2 part ETags from the S3 listing and queues the import", async () => {
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
  sdk.send = (command) => {
    if (command?.constructor.name !== "ListPartsCommand") {
      return Promise.reject(new Error("Direct S3 writes are forbidden"));
    }
    return Promise.resolve({
      Parts: [{ PartNumber: 1, ETag: '"etag-1"', Size: 1 }],
    });
  };
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
  const put = await worker.fetch(
    new Request(created.parts[0].url, {
      method: "PUT",
      body: new Blob([new Uint8Array([1])]),
      headers: { "content-length": "1" },
    }),
    env,
    { waitUntil: () => undefined } as never
  );
  expect(put.status).toBe(204);
  await signed.action(api.importUpload.completeImportUpload, {
    jobId: created.jobId,
  });
  expect(await t.run((ctx) => ctx.db.get(created.jobId))).toMatchObject({
    status: "queued",
  });
  expect(bucket.multipartCompletions[0].bytes).toEqual(new Uint8Array([1]));
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
