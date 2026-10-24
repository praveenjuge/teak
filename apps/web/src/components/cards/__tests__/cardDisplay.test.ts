import { describe, expect, test } from "bun:test";
import {
  formatDuration,
  getDisplayHostname,
  getFaviconUrl,
  getFileFormatBadge,
  isCardProcessing,
  readableTextOn,
  splitNotePreview,
} from "../cardDisplay";

describe("getDisplayHostname", () => {
  test("drops www. and keeps the rest of the host", () => {
    expect(getDisplayHostname("https://www.theverge.com/2024/a")).toBe(
      "theverge.com"
    );
    expect(getDisplayHostname("https://docs.convex.dev/x?y=1")).toBe(
      "docs.convex.dev"
    );
  });

  test("names no site for unsafe or missing links", () => {
    expect(getDisplayHostname("javascript:alert(1)")).toBeUndefined();
    expect(getDisplayHostname(undefined)).toBeUndefined();
  });
});

describe("getFaviconUrl", () => {
  test("sends only the hostname to the favicon service", () => {
    const url = getFaviconUrl("example.com");
    expect(url).toContain("domain=example.com");
    expect(getFaviconUrl(undefined)).toBeUndefined();
  });
});

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
