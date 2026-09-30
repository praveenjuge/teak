import { describe, expect, test } from "bun:test";
import {
  createMissingCardWorkflowResult,
  normalizeWorkflowMetadataResult,
  resolveCardProcessingDurationMs,
} from "../../workflows/cardProcessing";

describe("workflows/cardProcessing", () => {
  test("omits completion duration when the initial card is missing", () => {
    expect(resolveCardProcessingDurationMs(undefined, 1000)).toBeUndefined();
  });

  test("clamps completion duration to a non-negative value", () => {
    expect(resolveCardProcessingDurationMs(500, 1000)).toBe(500);
    expect(resolveCardProcessingDurationMs(1500, 1000)).toBe(0);
  });

  test("finishes a card deleted mid-run as skipped, not failed", () => {
    const result = createMissingCardWorkflowResult();

    expect(result).toEqual({
      success: true,
      mode: "skipped",
      reason: "card_missing",
    });
    expect(result).not.toHaveProperty("error");
  });
});

test("summarizes old persisted metadata journals and new compact results identically", () => {
  const expected = { aiTagsCount: 2, hasSummary: true, hasTranscript: true };
  expect(
    normalizeWorkflowMetadataResult({
      aiTags: ["one", "two"],
      aiSummary: "summary",
      aiTranscript: "transcript",
    })
  ).toEqual(expected);
  expect(normalizeWorkflowMetadataResult(expected)).toEqual(expected);
  expect(normalizeWorkflowMetadataResult(null)).toEqual({
    aiTagsCount: 0,
    hasSummary: false,
    hasTranscript: false,
  });
});
