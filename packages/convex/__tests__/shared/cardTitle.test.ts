import { describe, expect, test } from "bun:test";
import {
  cardDisplayTitle,
  cardPreviewText,
  MAX_CARD_TITLE_LENGTH,
  parseCardTitle,
  truncateCardTitle,
} from "../../shared/cardTitle";

describe("parseCardTitle", () => {
  test("trims a title", () => {
    expect(parseCardTitle("  Reading list  ")).toEqual({
      kind: "title",
      title: "Reading list",
    });
  });

  test.each([null, "", "   "])("clears the title for %p", (value) => {
    expect(parseCardTitle(value)).toEqual({ kind: "clear" });
  });

  test.each([42, undefined, { title: "x" }])("refuses %p", (value) => {
    expect(parseCardTitle(value)).toEqual({ kind: "invalid" });
  });

  test("cuts a title past the length limit", () => {
    expect(parseCardTitle("a".repeat(MAX_CARD_TITLE_LENGTH + 1))).toEqual({
      kind: "title",
      title: "a".repeat(MAX_CARD_TITLE_LENGTH),
    });
  });
});

describe("truncateCardTitle", () => {
  test("keeps a title within the limit, trimmed", () => {
    expect(truncateCardTitle("  Reading list ")).toBe("Reading list");
  });

  test("never ends on half of a two-unit character", () => {
    const title = `${"a".repeat(MAX_CARD_TITLE_LENGTH - 1)}😀 more`;
    expect(truncateCardTitle(title)).toBe(
      "a".repeat(MAX_CARD_TITLE_LENGTH - 1)
    );
  });

  test("drops the space a cut leaves at the end", () => {
    const title = `${"a".repeat(MAX_CARD_TITLE_LENGTH - 1)} b`;
    expect(truncateCardTitle(title)).toBe(
      "a".repeat(MAX_CARD_TITLE_LENGTH - 1)
    );
  });
});

const ID = "k17a8m9x2p3q4r5s6t7u8v9w0y1z2a3b";

describe("card display title", () => {
  test.each([
    [
      "a title the person typed before all",
      {
        content: "",
        metadata: {
          linkPreview: { source: "x", status: "success", title: "Preview" },
        },
        metadataTitle: "Field notes",
        metadataTitleEdited: true,
        type: "link",
        url: "https://www.example.com/a",
      },
      "Field notes",
    ],
    [
      "the link preview title first",
      {
        content: "",
        metadata: {
          linkPreview: { source: "x", status: "success", title: "Preview" },
        },
        metadataTitle: "Edited",
        type: "link",
        url: "https://www.example.com/a",
      },
      "Preview",
    ],
    [
      "then the card's title",
      { content: "Body", metadataTitle: "Edited", type: "text" },
      "Edited",
    ],
    [
      "then the file name",
      { content: "", fileMetadata: { fileName: "plan.pdf" }, type: "document" },
      "plan.pdf",
    ],
    [
      "then a link's site, without www",
      { content: "", type: "link", url: "https://www.example.com/a" },
      "example.com",
    ],
    [
      "a link's site as people read it, not punycode",
      { content: "", type: "link", url: "https://xn--r8jz45g.jp/a" },
      "例え.jp",
    ],
    [
      "then the first line",
      { content: "  First line\nSecond", type: "text" },
      "First line",
    ],
    [
      "the first line of CRLF text, without its carriage return",
      { content: "First line\r\nSecond", type: "text" },
      "First line",
    ],
    ["a palette", { content: "", type: "palette" }, "Color palette"],
    ["anything else", { content: "", type: "image" }, "Saved card"],
  ] as const)("%s", (_, card, title) => {
    expect(
      cardDisplayTitle(card as Parameters<typeof cardDisplayTitle>[0])
    ).toBe(title);
  });

  test("a note starting with a link uses the link's title", () => {
    const card = {
      content: `[[Reading list|teak:${ID}]] for May`,
      type: "text" as const,
    };
    expect(cardPreviewText(card)).toBe("Reading list for May");
    expect(cardDisplayTitle(card)).toBe("Reading list for May");
  });

  test("an audio card previews its transcript", () => {
    expect(
      cardPreviewText({
        aiTranscriptPreview: "Hello from the stored transcript",
        content: "",
        type: "audio",
      })
    ).toBe("Hello from the stored transcript");
  });
});
