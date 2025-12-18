import { describe, expect, test } from "bun:test";
import { buildLinkContentParts } from "./metadata";

describe("metadata link content fallback", () => {
  test("uses card.url when content is empty and link preview failed", () => {
    const contentParts = buildLinkContentParts({
      url: "https://example.com/article",
      content: "",
      metadata: {
        linkPreview: {
          status: "error",
        },
      },
    });

    expect(contentParts).toEqual(["URL: https://example.com/article"]);
  });
});
