import { describe, expect, test } from "bun:test";
import { aiReceiptKeyFor, aiReceiptKeysFor } from "@teak/files-core";
import { FILES_PROCESSOR_VERSION } from "@teak/files-protocol";
import {
  AI_RECEIPT_MAX_BYTES,
  type AiReceiptIdentity,
  hashReceiptInput,
  readAiReceipt,
  writeAiReceipt,
} from "./receipts";
import { FakeBucket } from "./testsupport";

const identity = (overrides: Partial<AiReceiptIdentity> = {}) => ({
  inputHash: "input-hash",
  model: "model-id",
  op: "transcribe-audio",
  processorVersion: FILES_PROCESSOR_VERSION,
  sourceEtag: '"source-etag"',
  ...overrides,
});

const writeValid = (
  bucket: FakeBucket,
  key: string,
  id: AiReceiptIdentity,
  result = { text: "hello" }
) =>
  writeAiReceipt(bucket as never, key, {
    inputHash: id.inputHash,
    model: id.model,
    op: id.op,
    result,
    sourceEtag: id.sourceEtag,
  });

describe("ai receipt keys", () => {
  test("derive one deterministic sidecar per operation", () => {
    expect(aiReceiptKeyFor("users/a/file", "transcribe-audio")).toBe(
      "users/a/file.receipts/transcribe-audio.json"
    );
    expect(aiReceiptKeysFor("users/a/file")).toEqual([
      "users/a/file.receipts/transcribe-audio.json",
      "users/a/file.receipts/generate-image-metadata.json",
    ]);
  });
});

describe("ai receipts", () => {
  test("round-trips a validated result", async () => {
    const bucket = new FakeBucket();
    const key = aiReceiptKeyFor("users/a/file", "transcribe-audio");
    await writeValid(bucket, key, identity());
    const cached = await readAiReceipt<{ text: string }>(
      bucket as never,
      key,
      identity()
    );
    expect(cached).toEqual({ text: "hello" });
  });

  test("misses when no sidecar exists", async () => {
    const bucket = new FakeBucket();
    const cached = await readAiReceipt(
      bucket as never,
      aiReceiptKeyFor("users/a/file", "transcribe-audio"),
      identity()
    );
    expect(cached).toBeNull();
  });

  test("rejects stale source etags", async () => {
    const bucket = new FakeBucket();
    const key = aiReceiptKeyFor("users/a/file", "transcribe-audio");
    await writeValid(bucket, key, identity());
    const cached = await readAiReceipt(
      bucket as never,
      key,
      identity({ sourceEtag: '"changed-etag"' })
    );
    expect(cached).toBeNull();
  });

  test("rejects changed input hashes", async () => {
    const bucket = new FakeBucket();
    const key = aiReceiptKeyFor("users/a/file", "transcribe-audio");
    await writeValid(bucket, key, identity());
    const changed = await hashReceiptInput({ mimeType: "audio/ogg" });
    const cached = await readAiReceipt(
      bucket as never,
      key,
      identity({ inputHash: changed })
    );
    expect(cached).toBeNull();
  });

  test("rejects changed processor versions and models", async () => {
    const bucket = new FakeBucket();
    const key = aiReceiptKeyFor("users/a/file", "transcribe-audio");
    await writeValid(bucket, key, identity());
    expect(
      await readAiReceipt(
        bucket as never,
        key,
        identity({ processorVersion: "files/0" })
      )
    ).toBeNull();
    expect(
      await readAiReceipt(bucket as never, key, identity({ model: "other" }))
    ).toBeNull();
    expect(
      await readAiReceipt(
        bucket as never,
        key,
        identity({ op: "generate-image-metadata" })
      )
    ).toBeNull();
  });

  test("rejects malformed and oversized sidecars without throwing", async () => {
    const bucket = new FakeBucket();
    const malformed = aiReceiptKeyFor("users/a/bad", "transcribe-audio");
    await bucket.put(malformed, "{not json");
    expect(
      await readAiReceipt(bucket as never, malformed, identity())
    ).toBeNull();

    const wrongShape = aiReceiptKeyFor("users/a/shape", "transcribe-audio");
    await bucket.put(wrongShape, JSON.stringify({ result: { text: "x" } }));
    expect(
      await readAiReceipt(bucket as never, wrongShape, identity())
    ).toBeNull();

    const oversized = aiReceiptKeyFor("users/a/big", "transcribe-audio");
    await bucket.put(oversized, "x".repeat(AI_RECEIPT_MAX_BYTES + 1));
    expect(
      await readAiReceipt(bucket as never, oversized, identity())
    ).toBeNull();
  });

  test("failed writes never throw", async () => {
    const bucket = {
      get: () => Promise.resolve(null),
      put: () => Promise.reject(new Error("r2_down")),
    };
    await writeAiReceipt(bucket, "key", {
      inputHash: "h",
      model: "m",
      op: "transcribe-audio",
      result: { text: "x" },
      sourceEtag: '"e"',
    });
  });

  test("hashes normalized inputs deterministically", async () => {
    const first = await hashReceiptInput({ mimeType: "audio/webm" });
    const second = await hashReceiptInput({ mimeType: "audio/webm" });
    const other = await hashReceiptInput({ mimeType: "audio/ogg" });
    expect(first).toBe(second);
    expect(first).not.toBe(other);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });
});
