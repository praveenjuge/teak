import { describe, expect, mock, test } from "bun:test";
import {
  buildFilesOpSigningPayload,
  FILES_AUDIO_MAX_BYTES,
  FILES_TRANSCRIPT_MAX_BYTES,
  FILES_TRANSCRIPTION_MODEL,
  type FilesOp,
} from "@teak/files-protocol";
import { strToU8, zipSync } from "fflate";
import { hmacSha256Hex, sha256Hex } from "./lib";
import { type FilesOpsEnv, handleInternalOp } from "./ops";
import { FakeBucket } from "./testsupport";
import { transcribeAudio } from "./transcript";

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
  test("streams R2 audio through the binding, returning only bounded transcript facts", async () => {
    const bucket = new FakeBucket();
    bucket.objects.set("users/u/audio.wav", {
      bytes: new Uint8Array([1, 2, 3]),
      httpMetadata: { contentType: "audio/wav" },
    });
    const run = mock(
      async (_model: string, inputs: Record<string, unknown>) => {
        const audio = inputs.audio as {
          body: ReadableStream;
          contentType: string;
        };
        expect(audio.contentType).toBe("audio/wav");
        expect(
          new Uint8Array(await new Response(audio.body).arrayBuffer())
        ).toEqual(new Uint8Array([1, 2, 3]));
        return {
          text: "Hello world",
          segments: [{ text: "Do not return segments" }],
        };
      }
    );
    const response = await handleInternalOp(
      await request("transcribe-audio", { sourceKey: "users/u/audio.wav" }),
      { ...envFor(bucket), AI: { run } }
    );
    expect(response.status).toBe(200);
    const result = (await response.json()) as { data: Record<string, unknown> };
    expect(result.data).toMatchObject({
      text: "Hello world",
      byteLength: 3,
      mimeType: "audio/wav",
    });
    expect(result.data).not.toHaveProperty("segments");
    expect(run.mock.calls[0][0]).toBe(FILES_TRANSCRIPTION_MODEL);
  });
  test("reuses the transcript receipt instead of invoking AI again", async () => {
    const bucket = new FakeBucket();
    bucket.objects.set("users/u/audio.wav", {
      bytes: new Uint8Array([1, 2, 3]),
      httpMetadata: { contentType: "audio/wav" },
    });
    const run = mock(async () => ({ text: "Hello world" }));
    const env = { ...envFor(bucket), AI: { run } };
    const first = await handleInternalOp(
      await request("transcribe-audio", { sourceKey: "users/u/audio.wav" }),
      env
    );
    expect(first.status).toBe(200);
    expect(run).toHaveBeenCalledTimes(1);
    const second = await handleInternalOp(
      await request("transcribe-audio", { sourceKey: "users/u/audio.wav" }),
      env
    );
    expect(second.status).toBe(200);
    expect(run).toHaveBeenCalledTimes(1);
    const result = (await second.json()) as { data: Record<string, unknown> };
    expect(result.data).toMatchObject({
      receiptReused: true,
      text: "Hello world",
    });
    expect(
      bucket.objects.has("users/u/audio.wav.receipts/transcribe-audio.json")
    ).toBe(true);
  });
  test("failed transcriptions cache nothing and retry AI on the next call", async () => {
    const bucket = new FakeBucket();
    bucket.objects.set("users/u/audio.wav", {
      bytes: new Uint8Array([1, 2, 3]),
      httpMetadata: { contentType: "audio/wav" },
    });
    const run = mock(() => Promise.reject(new Error("workers_ai_down")));
    const env = { ...envFor(bucket), AI: { run } };
    const failed = await handleInternalOp(
      await request("transcribe-audio", { sourceKey: "users/u/audio.wav" }),
      env
    );
    expect(failed.status).toBe(500);
    expect(
      bucket.objects.has("users/u/audio.wav.receipts/transcribe-audio.json")
    ).toBe(false);
  });
  test("rejects oversized audio before inference and bounds model output", async () => {
    const run = mock(async () => ({
      text: "x".repeat(FILES_TRANSCRIPT_MAX_BYTES + 1),
    }));
    const bucket = new FakeBucket();
    bucket.objects.set("users/u/audio", { bytes: new Uint8Array([1]) });
    const env = { ...envFor(bucket), AI: { run } };
    await expect(
      transcribeAudio(env, { sourceKey: "users/u/audio" })
    ).rejects.toThrow("source_too_large");
    const get = bucket.get.bind(bucket);
    bucket.get = (key, options) => {
      const object = get(key, options);
      return object ? { ...object, size: FILES_AUDIO_MAX_BYTES + 1 } : object;
    };
    run.mockClear();
    await expect(
      transcribeAudio(env, { sourceKey: "users/u/audio" })
    ).rejects.toThrow("source_too_large");
    expect(run).not.toHaveBeenCalled();
  });
  test("returns retryable failures for unavailable AI, and input errors for malformed requests", async () => {
    const bucket = new FakeBucket();
    bucket.objects.set("users/u/audio", { bytes: new Uint8Array([1]) });
    for (const params of [
      { sourceKey: 3 },
      { sourceKey: "users/u/../bad" },
      { sourceKey: "users/u/audio", mimeType: 5 },
    ]) {
      const response = await handleInternalOp(
        await request("transcribe-audio", params),
        envFor(bucket)
      );
      expect(response.status).toBe(400);
    }
    const response = await handleInternalOp(
      await request("transcribe-audio", { sourceKey: "users/u/audio" }),
      envFor(bucket)
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { retryable: true },
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
