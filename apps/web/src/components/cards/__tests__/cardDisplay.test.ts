import { describe, expect, test } from "bun:test";
import {
  formatDuration,
  getFileFormatBadge,
  isCardProcessing,
  mediaAspectRatio,
  quoteSizeClass,
  readableTextOn,
  splitNotePreview,
} from "../cardDisplay";

describe("getFileFormatBadge", () => {
  test.each([
    ["Annual report.pdf", "application/pdf", "PDF"],
    ["Deck.pptx", undefined, "PPTX"],
    ["design.tokens.json", "application/json", "JSON"],
  ])("labels %s as %s", (fileName, mimeType, badge) => {
    expect(getFileFormatBadge(fileName, mimeType)).toBe(badge);
  });

  test("shows no badge for names without a usable extension", () => {
    expect(getFileFormatBadge("README", "application/octet-stream")).toBe(
      undefined
    );
    expect(getFileFormatBadge("archive.verylongext")).toBeUndefined();
    expect(getFileFormatBadge(undefined)).toBeUndefined();
  });
});

describe("readableTextOn", () => {
  test("picks white on dark colors and black on light ones", () => {
    expect(readableTextOn("#000000")).toBe("white");
    expect(readableTextOn("#1c1917")).toBe("white");
    expect(readableTextOn("#ffffff")).toBe("black");
    expect(readableTextOn("#FFBE0B")).toBe("black");
  });

  test("falls back to black for a color it can't read", () => {
    expect(readableTextOn("not-a-color")).toBe("black");
  });
});

describe("splitNotePreview", () => {
  test("uses the first line as a heading when more follows", () => {
    expect(splitNotePreview("Groceries\n\nOat milk, lemons")).toEqual({
      heading: "Groceries",
      body: "Oat milk, lemons",
    });
  });

  test("reads a note that opens with a table as one body, with no title", () => {
    const table = "| Plan | Price |\n| --- | --- |\n| Free | $0 |";
    expect(splitNotePreview(table)).toEqual({ body: table });
    expect(splitNotePreview(`# Plans\n\n${table}`)).toEqual({
      heading: "# Plans",
      body: table,
    });
  });

  test("keeps a one-paragraph note as body text", () => {
    expect(splitNotePreview("  Just one thought  ")).toEqual({
      body: "Just one thought",
    });
    expect(splitNotePreview("Only a heading\n\n")).toEqual({
      body: "Only a heading",
    });
    expect(splitNotePreview(undefined)).toEqual({ body: "" });
  });
});

describe("formatDuration", () => {
  test.each([
    [17.4, "0:17"],
    [84, "1:24"],
    [3725, "1:02:05"],
  ])("formats %s seconds as %s", (seconds, label) => {
    expect(formatDuration(seconds)).toBe(label);
  });

  test("hides unknown lengths", () => {
    expect(formatDuration(undefined)).toBeUndefined();
    expect(formatDuration(0)).toBeUndefined();
    expect(formatDuration(Number.NaN)).toBeUndefined();
  });
});

describe("isCardProcessing", () => {
  test("is true while any stage is pending or running", () => {
    expect(
      isCardProcessing({
        processingStatus: {
          classify: { status: "completed" },
          metadata: { status: "in_progress" },
        },
      })
    ).toBe(true);
    expect(
      isCardProcessing({
        processingStatus: { renderables: { status: "pending" } },
      })
    ).toBe(true);
  });

  test("is false once every stage has finished or failed", () => {
    expect(
      isCardProcessing({
        processingStatus: {
          classify: { status: "completed" },
          metadata: { status: "failed" },
        },
      })
    ).toBe(false);
    expect(isCardProcessing({})).toBe(false);
  });

  test("a link saving its page's copy isn't shown as processing", () => {
    expect(
      isCardProcessing({
        processingStatus: {
          archive: { status: "in_progress" },
          metadata: { status: "completed" },
        },
      })
    ).toBe(false);
  });
});

describe("mediaAspectRatio", () => {
  test("keeps an image's own shape inside 3:4 to 16:9", () => {
    expect(mediaAspectRatio(800, 600, 1)).toBeCloseTo(4 / 3);
    expect(mediaAspectRatio(440, 720, 1)).toBeCloseTo(3 / 4);
    expect(mediaAspectRatio(4000, 500, 1)).toBeCloseTo(16 / 9);
  });

  test("uses the fallback when the size is missing or broken", () => {
    expect(mediaAspectRatio(undefined, 600, 4 / 3)).toBeCloseTo(4 / 3);
    expect(mediaAspectRatio(800, 0, 4 / 3)).toBeCloseTo(4 / 3);
    expect(mediaAspectRatio(-1, 600, 0.2)).toBeCloseTo(3 / 4);
  });
});

describe("quoteSizeClass", () => {
  test("sets short quotes large and long quotes small", () => {
    expect(quoteSizeClass("Design is thinking made visual.")).toBe(
      "text-[23px]"
    );
    expect(
      quoteSizeClass(
        "Styles come and go. Good design is a language, not a style."
      )
    ).toBe("text-[19px]");
    expect(quoteSizeClass("x".repeat(200))).toBe("text-[15px]");
  });
});
