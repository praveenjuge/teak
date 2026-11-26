import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "../../_generated/api";
import { newBackend, signIn } from "../helpers.testUtils";

const OWNER = "import-cancel-owner";
const FILE = { mode: "archive" as const, fileName: "teak.zip", fileSize: 10 };

beforeEach(() => {
  vi.stubEnv("FILES_BASE", "https://files.test");
  vi.stubEnv("FILES_SIGNING_SECRET", "test-upload-signing-value");
  vi.stubEnv("R2_KEY_PREFIX", "");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test("canceling an import while its upload is being set up cancels it and frees the next import", async () => {
  const t = newBackend();
  const owner = await signIn(t, OWNER);
  const ops: string[] = [];
  let canceled: unknown;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: unknown, init?: RequestInit) => {
      const { op } = JSON.parse(String(init?.body)) as { op: string };
      ops.push(op);
      if (op === "create-multipart" && ops.length === 1) {
        // The Cancel button shows as soon as the job row exists; the person
        // presses it while R2 is still creating the upload.
        const job = await owner.query(api.dataImport.getLatestImport, {});
        canceled = await owner.action(api.importUpload.cancelImport, {
          jobId: job?.id as never,
        });
      }
      return Response.json({
        ok: true,
        version: 1,
        requestId: "r",
        data: { uploadId: `upload-${ops.length}` },
      });
    })
  );

  await expect(
    owner.action(api.importUpload.createImportUpload, {
      ...FILE,
      fileLastModified: 1,
    })
  ).rejects.toThrow();

  expect(canceled).toEqual({ canceled: true });
  const job = await owner.query(api.dataImport.getLatestImport, {});
  expect(job?.status).toBe("canceled");
  // The upload R2 created for the canceled job is aborted, not left behind.
  expect(ops).toEqual(["create-multipart", "abort-multipart"]);

  const next = await owner.action(api.importUpload.createImportUpload, {
    ...FILE,
    fileLastModified: 2,
  });
  expect(next.jobId).not.toBe(job?.id);
});
