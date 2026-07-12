import { describe, expect, test } from "bun:test";
import {
  hasKnownTinyImageDimensions,
  hasMinimumImageAnalysisDimensions,
  MIN_IMAGE_ANALYSIS_DIMENSION,
} from "../../workflows/imageAnalysis";

describe("image analysis dimensions", () => {
  test("accepts images at or above the minimum dimensions", () => {
    expect(
      hasMinimumImageAnalysisDimensions({
        height: MIN_IMAGE_ANALYSIS_DIMENSION,
        width: MIN_IMAGE_ANALYSIS_DIMENSION,
      })
    ).toBe(true);
  });

  test("rejects known tiny images", () => {
    expect(hasKnownTinyImageDimensions({ height: 1, width: 1 })).toBe(true);
    expect(hasMinimumImageAnalysisDimensions({ height: 1, width: 1 })).toBe(
      false
    );
  });

  test("does not treat missing dimensions as a known tiny image", () => {
    expect(hasKnownTinyImageDimensions()).toBe(false);
    expect(hasMinimumImageAnalysisDimensions()).toBe(false);
  });
});
