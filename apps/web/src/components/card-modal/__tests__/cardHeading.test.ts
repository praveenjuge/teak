import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { formatAddedDate, getCardHeading } from "../cardHeading";

describe("getCardHeading", () => {
  test("names a link by the title someone set, then the page's title", () => {
    expect(
      getCardHeading({
        type: "link",
        url: "https://example.com",
        metadataTitle: "My name for it",
        metadataTitleEdited: true,
        metadata: { linkPreview: { status: "success", title: "Page title" } },
      })
    ).toEqual({ editable: true, title: "My name for it" });
    expect(
      getCardHeading({
        type: "link",
        url: "https://example.com",
        metadata: { linkPreview: { status: "success", title: "Page title" } },
      }).title
    ).toBe("Page title");
  });

  test("names a file by its file name and can't rename it", () => {
    expect(
      getCardHeading({ type: "image", fileMetadata: { fileName: "lily.webp" } })
    ).toEqual({ editable: false, title: "lily.webp" });
  });

  test("names notes, quotes and palettes by their kind", () => {
    expect(getCardHeading({ type: "text" }).title).toBe("Note");
    expect(getCardHeading({ type: "quote" }).title).toBe("Quote");
    expect(getCardHeading({ type: "palette" }).title).toBe("Palette");
  });
});

describe("formatAddedDate", () => {
  const now = new Date(2026, 9, 14, 15, 0).getTime();

  test("says today and yesterday", () => {
    expect(formatAddedDate(new Date(2026, 9, 14, 0, 5).getTime(), now)).toBe(
      "Added today"
    );
    expect(formatAddedDate(new Date(2026, 9, 13, 23, 0).getTime(), now)).toBe(
      "Added yesterday"
    );
  });

  test("leaves out this year's year but names earlier ones", () => {
    expect(formatAddedDate(new Date(2026, 2, 4).getTime(), now)).toBe(
      "Added Mar 4"
    );
    expect(formatAddedDate(new Date(2024, 2, 4).getTime(), now)).toBe(
      "Added Mar 4, 2024"
    );
  });
});

describe("formatAddedDate across a daylight saving change", () => {
  const originalTz = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = "America/Los_Angeles";
  });

  afterAll(() => {
    if (originalTz === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTz;
    }
  });

  test("calls the whole 25-hour day before yesterday after clocks fall back", () => {
    // Clocks fell back on Sunday Nov 1 2026 in Los Angeles.
    const now = new Date(2026, 10, 2, 10, 0).getTime();
    expect(formatAddedDate(new Date(2026, 10, 1, 0, 30).getTime(), now)).toBe(
      "Added yesterday"
    );
  });

  test("does not call the day before yesterday after clocks spring forward", () => {
    // Clocks sprang forward on Sunday Mar 8 2026 in Los Angeles.
    const now = new Date(2026, 2, 9, 10, 0).getTime();
    expect(formatAddedDate(new Date(2026, 2, 7, 23, 30).getTime(), now)).toBe(
      "Added Mar 7"
    );
    expect(formatAddedDate(new Date(2026, 2, 8, 0, 30).getTime(), now)).toBe(
      "Added yesterday"
    );
  });
});
