import { describe, expect, test } from "bun:test";
import { buildFilesOpSigningPayload, type FilesOp } from "@teak/files-protocol";
import { strToU8, zipSync } from "fflate";
import { hmacSha256Hex, sha256Hex } from "./lib";
import { type FilesOpsEnv, handleInternalOp } from "./ops";
import { FakeBucket } from "./testsupport";

async function request(op: FilesOp, params: Record<string, unknown>) {
  const body = JSON.stringify({ version: 1, op, params });
  const expiresAt = String(Math.floor(Date.now() / 1000) + 600),
    requestId = "test";
  return new Request("http://localhost/__ops/v1", {
    method: "POST",
    body,
    headers: {
      "x-teak-request-id": requestId,
      "x-teak-expires-at": expiresAt,
      "x-teak-signature": await hmacSha256Hex(
        "test-secret",
        buildFilesOpSigningPayload({
          bodySha256: await sha256Hex(body),
          expiresAt,
          requestId,
        })
      ),
    },
  });
}
const envFor = (bucket: FakeBucket): FilesOpsEnv => ({
  BUCKET: bucket as unknown as R2Bucket,
  FILES_SIGNING_SECRET: "test-secret",
});

describe("signed file operations", () => {
  test("malformed archive JSON is a non-retryable input failure", async () => {
    const bucket = new FakeBucket();
    const key = "users/u/imports/job/source.zip";
    const bytes = zipSync({
      "manifest.json": strToU8('{"version":1,"cards":[}'),
    });
    bucket.objects.set(key, { bytes });
    const response = await handleInternalOp(
      await request("index-import-source", {
        sourceKey: key,
        mode: "archive",
        expectedSize: bytes.length,
      }),
      envFor(bucket)
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_INPUT", retryable: false },
    });
  });
  test("indexes and extracts through signed routes with source-version and user isolation", async () => {
    const bucket = new FakeBucket(),
      key = "users/u/imports/job/source.zip";
    const bytes = zipSync(
      {
        "manifest.json": strToU8(
          '{"version":1,"cards":[{"type":"document","file":{"path":"files/a.txt"}}]}'
        ),
        "files/a.txt": strToU8("Hello"),
      },
      { level: 0 }
    );
    bucket.objects.set(key, { bytes });
    const indexed = await handleInternalOp(
      await request("index-import-source", {
        sourceKey: key,
        mode: "archive",
        expectedSize: bytes.length,
      }),
      envFor(bucket)
    );
    expect(indexed.status).toBe(200);
    const page = (await indexed.json()) as {
      data: { sourceEtag: string; items: unknown[] };
    };
    expect(page.data.items).toEqual([
      {
        sourceIndex: 0,
        card: { type: "document", file: { path: "files/a.txt" } },
        file: { path: "files/a.txt", uncompressedSize: 5 },
      },
    ]);
    const extracted = await handleInternalOp(
      await request("extract-import-files", {
        archiveKey: key,
        sourceEtag: page.data.sourceEtag,
        entries: [
          {
            path: "files/a.txt",
            destinationKey: "users/u/import-job/item/file/a.txt",
          },
        ],
      }),
      envFor(bucket)
    );
    expect(extracted.status).toBe(200);
    expect(bucket.storedBytes("users/u/import-job/item/file/a.txt")).toEqual(
      strToU8("Hello")
    );
    const changed = await handleInternalOp(
      await request("read-import-markdown", {
        sourceKey: key,
        sourceEtag: '"old"',
        path: "files/a.txt",
      }),
      envFor(bucket)
    );
    expect(changed.status).toBe(409);
    const unsigned = await handleInternalOp(
      new Request("http://localhost/__ops/v1", {
        method: "POST",
        body: JSON.stringify({
          op: "index-import-source",
          version: 1,
          params: { sourceKey: key },
        }),
      }),
      envFor(bucket)
    );
    expect(unsigned.status).toBe(401);
  });
  test("only suppresses a confirmed missing multipart upload", async () => {
    const bucket = new FakeBucket();
    bucket.resumeMultipartUpload = () => {
      throw new Error("R2: NoSuchUpload (10024)");
    };
    expect(
      (
        await handleInternalOp(
          await request("abort-multipart", {
            key: "users/u/imports/job/source",
            uploadId: "gone",
          }),
          envFor(bucket)
        )
      ).status
    ).toBe(200);
    bucket.resumeMultipartUpload = () => {
      throw new Error("R2: ServiceUnavailable (10043)");
    };
    expect(
      (
        await handleInternalOp(
          await request("abort-multipart", {
            key: "users/u/imports/job/source",
            uploadId: "gone",
          }),
          envFor(bucket)
        )
      ).status
    ).toBe(500);
  });
});
