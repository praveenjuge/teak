// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { toMobileCardSummary } from "../../card/mobileCardSummaries";

describe("mobile card summaries", () => {
  test("returns compact display fields without full card content", () => {
    const longContent = "A".repeat(400);
    const summary = toMobileCardSummary({
      _creationTime: 1,
      _id: "card-1",
      colors: [{ hex: "#112233", percentage: 1 }],
      content: longContent,
      createdAt: 1,
      processingStatus: {},
      thumbnailUrl: "https://example.com/thumb.jpg",
      type: "text",
      updatedAt: 1,
      userId: "user-1",
    });

    expect(summary.previewText).toHaveLength(280);
    expect(summary.thumbnailUrl).toBe("https://example.com/thumb.jpg");
    expect(summary.colors).toEqual(["#112233"]);
    expect(summary).not.toHaveProperty("content");
    expect(summary).not.toHaveProperty("aiTranscript");
    expect(summary).not.toHaveProperty("fileUrl");
  });
});
