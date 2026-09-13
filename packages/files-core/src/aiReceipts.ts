/**
 * Deterministic AI receipt sidecar keys shared by the worker (which reads
 * and writes receipts) and Convex (which deletes and reconciles them).
 *
 * A receipt lives beside its source object (`<source>.receipts/<op>.json`)
 * so it inherits the source's user namespace and dies with the card.
 */

export const AI_RECEIPT_OPS = [
  "transcribe-audio",
  "generate-image-metadata",
] as const;

export type AiReceiptOp = (typeof AI_RECEIPT_OPS)[number];

export const isAiReceiptOp = (value: unknown): value is AiReceiptOp =>
  value === "transcribe-audio" || value === "generate-image-metadata";

/** Deterministic per-operation sidecar key for an AI result receipt. */
export const aiReceiptKeyFor = (sourceKey: string, op: AiReceiptOp): string =>
  `${sourceKey}.receipts/${op}.json`;

/** Every receipt sidecar a stored source object may own. */
export const aiReceiptKeysFor = (sourceKey: string): string[] =>
  AI_RECEIPT_OPS.map((op) => aiReceiptKeyFor(sourceKey, op));
