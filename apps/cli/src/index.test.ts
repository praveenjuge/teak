import { describe, expect, test } from "bun:test";
import { formatCardLine, mimeFor, typeForMime } from ".";

describe("teak cli formatting", () => {
  test("formats stable one-line cards", () => {
    const line = formatCardLine({
      content: "A useful design note with a little extra text for truncation",
      createdAt: Date.now() - 120_000,
      id: "card_1",
      tags: ["design", "cli"],
      type: "text",
    });
    expect(line).toContain("card_1");
    expect(line).toContain("text");
    expect(line).toContain("#design #cli");
  });

  test("maps file extensions and MIME types for uploads", () => {
    expect(mimeFor("/tmp/a.png")).toBe("image/png");
    expect(mimeFor("/tmp/a.unknown")).toBe("application/octet-stream");
    expect(typeForMime("video/mp4")).toBe("video");
    expect(typeForMime("application/pdf")).toBe("document");
  });
});
