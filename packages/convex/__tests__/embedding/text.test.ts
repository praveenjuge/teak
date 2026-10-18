import { describe, expect, test } from "bun:test";
import { buildEmbeddingText } from "../../embedding/text";

describe("buildEmbeddingText", () => {
  test("puts the text read from an image after the styles and before the body", () => {
    expect(
      buildEmbeddingText({
        aiOcrText: "Invoice 4411\nTotal due $5.50",
        aiSummary: "A grocery receipt",
        aiTags: ["receipt"],
        content: "Kept for taxes",
        tags: ["finance"],
        visualStyles: ["minimal"],
      })
    ).toBe(
      [
        "A grocery receipt",
        "Tags: finance, receipt",
        "Style: minimal",
        "Invoice 4411\nTotal due $5.50",
        "Kept for taxes",
      ].join("\n")
    );
  });

  test("a card with only image text is embedded from it", () => {
    expect(
      buildEmbeddingText({ aiOcrText: "  SCALING POSTGRES  ", content: "" })
    ).toBe("SCALING POSTGRES");
  });

  test("image text is cut like the body, so the body still fits", () => {
    const text = buildEmbeddingText({
      aiOcrText: "word ".repeat(1000),
      content: "The body",
    });
    expect(text.endsWith("\nThe body")).toBe(true);
    expect(text.split("\n")[0]).toHaveLength(2000);
  });

  test("a card with no text yet has none", () => {
    expect(buildEmbeddingText({ aiOcrText: "   ", content: "" })).toBe("");
  });

  test("a note's [[…]] links are embedded as their titles", () => {
    expect(
      buildEmbeddingText({
        content: "See [[Garden plan|teak:k17a8m9x2p3q4r5s6t7u8v9w0y1z2a3b]]",
      })
    ).toBe("See Garden plan");
  });
});
