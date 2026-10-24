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

describe("buildEmbeddingText: a link's article", () => {
  const article = `${"Opening words of the article. ".repeat(80)}LATE-TAIL`;

  test("the article's opening is the body when the link's content is its URL", () => {
    const text = buildEmbeddingText(
      {
        aiSummary: "How gardens grow",
        content: "https://site.example/gardens",
        metadata: { linkPreview: { status: "success", title: "Gardens" } },
        url: "https://site.example/gardens",
      },
      article,
      "article"
    );
    const lines = text.split("\n");
    expect(lines[0]).toBe("Gardens");
    expect(lines[1]).toBe("How gardens grow");
    expect(text).not.toContain("https://site.example/gardens");
    expect(lines.at(-1)).toHaveLength(1500);
    expect(text).not.toContain("LATE-TAIL");
  });

  test("content that only repeats the title doesn't hide the article", () => {
    const text = buildEmbeddingText(
      {
        content: "Gardens",
        metadataTitle: "Gardens",
        url: "https://site.example/gardens",
      },
      "The article body.",
      "article"
    );
    expect(text).toBe("Gardens\nThe article body.");
  });

  test("a document's text still reads up to 2,000 characters", () => {
    const text = buildEmbeddingText({ content: "" }, "d".repeat(5000));
    expect(text).toHaveLength(2000);
  });
});
