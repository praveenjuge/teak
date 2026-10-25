import { describe, expect, test } from "bun:test";
import { cardDisplayTitle, cardPreviewText } from "../../card/displayTitle";

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
