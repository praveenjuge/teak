import { FILES_PROCESSOR_VERSION } from "@teak/files-protocol";
import { sha256Hex } from "./lib";

/**
 * Durable AI result receipts.
 *
 * `transcribe-audio` and `generate-image-metadata` are the costliest worker
 * operations. Each stores its validated result in a deterministic R2 sidecar
 * beside the source object; later calls with the same source ETag,
 * normalized input, processor version, and model reuse the receipt instead
 * of invoking AI again.
 *
 * Receipts are an optimization, never a correctness dependency: any miss,
 * mismatch, or malformed sidecar falls through to a fresh AI call, and a
 * failed write never fails an otherwise valid result. Concurrent first
 * executions may duplicate work; distributed locking is deferred.
 */

export const AI_RECEIPT_MAX_BYTES = 512 * 1024;

export interface AiReceiptEnvelope<T> {
  createdAt: number;
  inputHash: string;
  model: string;
  op: string;
  processorVersion: string;
  result: T;
  sourceEtag: string;
}

export interface AiReceiptIdentity {
  inputHash: string;
  model: string;
  op: string;
  processorVersion: string;
  sourceEtag: string;
}

/** Stable hash of the normalized small inputs (byte identity comes from ETag). */
export const hashReceiptInput = async (input: unknown): Promise<string> =>
  sha256Hex(JSON.stringify(input) ?? "null");

type ReceiptBucket = Pick<R2Bucket, "get" | "put">;

const isValidEnvelope = <T>(
  value: unknown,
  expected: AiReceiptIdentity
): value is AiReceiptEnvelope<T> => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const envelope = value as Partial<AiReceiptEnvelope<T>>;
  return (
    typeof envelope.createdAt === "number" &&
    envelope.op === expected.op &&
    envelope.sourceEtag === expected.sourceEtag &&
    envelope.inputHash === expected.inputHash &&
    envelope.processorVersion === expected.processorVersion &&
    envelope.model === expected.model &&
    typeof envelope.result === "object" &&
    envelope.result !== null
  );
};

/**
 * Read a validated receipt, or null on miss, staleness, oversize, or any
 * malformed content. Never throws for receipt problems.
 */
export const readAiReceipt = async <T>(
  bucket: ReceiptBucket,
  receiptKey: string,
  expected: AiReceiptIdentity
): Promise<T | null> => {
  let object: R2ObjectBody | null;
  try {
    object = await bucket.get(receiptKey);
  } catch {
    return null;
  }
  if (!object) {
    return null;
  }
  try {
    if (object.size > AI_RECEIPT_MAX_BYTES) {
      await object.body.cancel().catch(() => undefined);
      return null;
    }
    const text = await object.text();
    const parsed: unknown = JSON.parse(text);
    if (!isValidEnvelope<T>(parsed, expected)) {
      return null;
    }
    return parsed.result;
  } catch {
    return null;
  }
};

/**
 * Persist a validated AI result. Best-effort: a failed write only costs the
 * next call a recomputation, so it never throws.
 */
export const writeAiReceipt = async <T>(
  bucket: ReceiptBucket,
  receiptKey: string,
  envelope: Omit<AiReceiptEnvelope<T>, "createdAt" | "processorVersion"> & {
    createdAt?: number;
  }
): Promise<void> => {
  const body: AiReceiptEnvelope<T> = {
    createdAt: envelope.createdAt ?? Date.now(),
    inputHash: envelope.inputHash,
    model: envelope.model,
    op: envelope.op,
    processorVersion: FILES_PROCESSOR_VERSION,
    result: envelope.result,
    sourceEtag: envelope.sourceEtag,
  };
  try {
    await bucket.put(receiptKey, JSON.stringify(body), {
      httpMetadata: { contentType: "application/json" },
    });
  } catch (error) {
    console.warn("ai.receipt.write_failed", {
      error: error instanceof Error ? error.message : String(error),
      receiptKey,
    });
  }
};
