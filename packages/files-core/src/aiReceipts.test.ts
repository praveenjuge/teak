import { describe, expect, test } from "bun:test";
import {
  AI_RECEIPT_OPS,
  aiReceiptKeyFor,
  aiReceiptKeysFor,
  isAiReceiptOp,
} from "./aiReceipts";

describe("ai receipt keys", () => {
  test("derive deterministic per-operation sidecars", () => {
    expect([...AI_RECEIPT_OPS]).toEqual([
      "transcribe-audio",
      "generate-image-metadata",
    ]);
    expect(aiReceiptKeyFor("users/a/file", "transcribe-audio")).toBe(
      "users/a/file.receipts/transcribe-audio.json"
    );
    expect(aiReceiptKeysFor("users/a/file")).toEqual([
      "users/a/file.receipts/transcribe-audio.json",
      "users/a/file.receipts/generate-image-metadata.json",
    ]);
  });

  test("recognize only known receipt operations", () => {
    expect(isAiReceiptOp("transcribe-audio")).toBe(true);
    expect(isAiReceiptOp("generate-image-metadata")).toBe(true);
    expect(isAiReceiptOp("analyze-image")).toBe(false);
    expect(isAiReceiptOp(null)).toBe(false);
  });
});
