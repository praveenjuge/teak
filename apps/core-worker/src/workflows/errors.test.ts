import { describe, expect, test } from "bun:test";
import { decodeStepError, encodeStepError, supersededReason } from "./errors";

describe("supersededReason", () => {
  test.each([
    ["card_missing:card/processingRpc:getCardForProcessing", "card_missing"],
    [
      "NonRetryableError: stale_processing_revision:linkMetadata:update#1",
      "stale_processing_revision",
    ],
    ["NonRetryableError: card_missing:x", "card_missing"],
    ["convex_rpc_unavailable:x:503", null],
    ["the card_missing flag was set", null],
  ])("reads %p as %p", (message, reason) => {
    expect(supersededReason(new Error(message))).toBe(reason);
  });
});

describe("step errors", () => {
  const PREFIX = "workflow:test:retryable:";

  test("carry their facts across a step, NonRetryableError prefix or not", () => {
    const error = encodeStepError(PREFIX, { type: "http_error", status: 503 });
    expect(decodeStepError(PREFIX, error)).toEqual({
      status: 503,
      type: "http_error",
    });
    expect(
      decodeStepError(PREFIX, new Error(`NonRetryableError: ${error.message}`))
    ).toEqual({ status: 503, type: "http_error" });
  });

  test.each([
    ["another prefix", 'workflow:other:retryable:{"type":"x"}'],
    ["broken JSON", `${PREFIX}{`],
    ["no type", `${PREFIX}{"status":1}`],
  ])("ignore %s", (_name, message) => {
    expect(decodeStepError(PREFIX, new Error(message))).toBeNull();
  });
});
