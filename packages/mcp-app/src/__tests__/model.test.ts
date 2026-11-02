import { describe, expect, test } from "bun:test";
import { toTeakCard, viewFromToolResult } from "../model";
import { linkCard, noteCard, paletteCard } from "./fixtures";

describe("toTeakCard", () => {
  test("reads a link's title, image, site and tags", () => {
    expect(toTeakCard(linkCard)).toEqual({
      aiSummary: "A field guide to variable fonts on the web.",
      appUrl: "https://app.teakvault.com/?card=k1",
      colors: [],
      content: "https://example.com/fonts",
      fileName: null,
      id: "k1",
      imageUrl: "https://files.teakvault.com/r2/k1.webp?exp=1&sig=a",
      isFavorited: true,
      notes: "Read before the redesign",
      siteName: "Example",
      tags: ["fonts", "typography"],
      title: "Variable fonts, explained",
      type: "link",
      url: "https://example.com/fonts",
    });
  });

  test("titles a note by its first line, without Markdown marks", () => {
    expect(toTeakCard(noteCard)?.title).toBe("Launch checklist");
  });

  test("keeps only valid palette colors", () => {
    expect(toTeakCard(paletteCard)?.colors).toEqual([
      { hex: "#1F2937", name: "Ink" },
      { hex: "#F97316" },
    ]);
  });

  test("drops URLs that aren't http or https", () => {
    const card = toTeakCard({
      ...linkCard,
      appUrl: "javascript:alert(1)",
      linkPreviewImageUrl: "data:image/png;base64,AAAA",
      url: "file:///etc/passwd",
    });
    expect(card?.appUrl).toBeNull();
    expect(card?.imageUrl).toBeNull();
    expect(card?.url).toBeNull();
  });

  test("rejects a value with no id", () => {
    expect(toTeakCard({ type: "link" })).toBeNull();
    expect(toTeakCard(null)).toBeNull();
  });
});

describe("viewFromToolResult", () => {
  test("shows a search as a list titled by its query", () => {
    const view = viewFromToolResult({
      input: { q: "fonts" },
      result: { structuredContent: { items: [linkCard, { bad: true }] } },
      toolName: "teak_v1_search_cards",
    });
    expect(view).toMatchObject({
      kind: "list",
      query: "fonts",
      source: "search",
    });
    expect(view.kind === "list" && view.cards.map((card) => card.id)).toEqual([
      "k1",
    ]);
  });

  test.each([
    ["teak_v1_list_favorite_cards", "favorites"],
    ["teak_v1_list_pinned_cards", "pinned"],
    ["teak_v1_list_cards", "recent"],
    [undefined, "search"],
  ])("names the list for %s", (toolName, source) => {
    expect(
      viewFromToolResult({
        result: { structuredContent: { items: [] } },
        toolName,
      })
    ).toMatchObject({ kind: "list", source });
  });

  test("shows a created card as saved, and a re-save as moved", () => {
    expect(
      viewFromToolResult({
        result: {
          structuredContent: {
            appUrl: "https://app.teakvault.com/?card=k1",
            card: linkCard,
            cardId: "k1",
            resaved: true,
            status: "created",
          },
        },
      })
    ).toMatchObject({ card: { id: "k1" }, kind: "saved", resaved: true });
  });

  test("shows one card in detail", () => {
    expect(
      viewFromToolResult({ result: { structuredContent: noteCard } })
    ).toMatchObject({ card: { id: "n1" }, kind: "card" });
  });

  test("shows an error for a failed call or an unreadable result", () => {
    expect(
      viewFromToolResult({
        result: { isError: true, structuredContent: { code: "NOT_FOUND" } },
      })
    ).toEqual({ kind: "error" });
    expect(viewFromToolResult({ result: {} })).toEqual({ kind: "error" });
  });
});

describe("card images and titles", () => {
  test("a link shows its preview image before its page screenshot", () => {
    expect(
      toTeakCard({
        ...linkCard,
        linkPreviewImageUrl: "https://files.teakvault.com/preview.webp",
        screenshotUrl: "https://files.teakvault.com/screenshot.webp",
      })?.imageUrl
    ).toBe("https://files.teakvault.com/preview.webp");
    expect(
      toTeakCard({
        ...linkCard,
        linkPreviewImageUrl: null,
        screenshotUrl: "https://files.teakvault.com/screenshot.webp",
      })?.imageUrl
    ).toBe("https://files.teakvault.com/screenshot.webp");
  });

  test("a link not read yet is titled by its address", () => {
    expect(
      toTeakCard({
        id: "k2",
        type: "link",
        url: "https://www.example.com/articles/fonts/",
      })?.title
    ).toBe("example.com/articles/fonts");
  });

  test("a palette without a name has no title", () => {
    expect(
      toTeakCard({ ...paletteCard, metadataTitle: null })?.title
    ).toBeNull();
  });
});

describe("a card saved from an upload", () => {
  test("is confirmed from the call's input, since the result has no card", () => {
    expect(
      viewFromToolResult({
        input: {
          fileKey: "files/u1",
          fileName: "Moodboard.png",
          fileSize: 1024,
          mimeType: "image/png",
        },
        result: {
          structuredContent: {
            appUrl: "https://app.teakvault.com/?card=f1",
            cardId: "f1",
            status: "created",
          },
        },
        toolName: "teak_v1_create_card",
      })
    ).toMatchObject({
      card: {
        appUrl: "https://app.teakvault.com/?card=f1",
        id: "f1",
        title: "Moodboard.png",
        type: "image",
      },
      kind: "saved",
      resaved: false,
    });
  });

  test("calls a file that isn't media a document", () => {
    expect(
      viewFromToolResult({
        input: { fileName: "Brief.pdf", mimeType: "application/pdf" },
        result: { structuredContent: { cardId: "f2", status: "created" } },
      })
    ).toMatchObject({ card: { id: "f2", type: "document" }, kind: "saved" });
  });
});
