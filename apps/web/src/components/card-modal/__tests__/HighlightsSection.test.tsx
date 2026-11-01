import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { HighlightsSection } from "../CardMetadataPanel";

const highlight = (id: string, fields: Record<string, unknown> = {}) =>
  ({
    _creationTime: 1,
    _id: id,
    cardId: "card_1",
    createdAt: 1,
    end: 20,
    quote: `Quote ${id}`,
    source: "reader",
    start: 10,
    updatedAt: 1,
    userId: "u",
    ...fields,
  }) as never;

const card = (fields: Record<string, unknown> = {}) =>
  ({
    _creationTime: 0,
    _id: "card_1",
    article: {
      status: "ready",
      textKey: "k",
      imageKeys: [],
      wordCount: 600,
      readingMinutes: 3,
      extractedAt: 1,
    },
    content: "https://example.com",
    createdAt: 1,
    type: "link",
    updatedAt: 1,
    userId: "u",
    ...fields,
  }) as never;

const render = (
  items: never[],
  cardFields: Record<string, unknown> = {},
  onJump: ((id: string) => void) | undefined = () => undefined
) =>
  renderToStaticMarkup(
    <HighlightsSection
      card={card(cardFields)}
      control={{ items, onJump, onRemove: () => undefined }}
    />
  );

describe("Highlights in the panel", () => {
  test("is not there without highlights", () => {
    expect(render([])).toBe("");
    expect(renderToStaticMarkup(<HighlightsSection card={card()} />)).toBe("");
  });

  test("is titled with its count, each quote with its note", () => {
    const html = render([
      highlight("h1", { note: "Why it matters" }),
      highlight("h2"),
      highlight("h3"),
      highlight("h4"),
    ]);
    expect(html).toContain('aria-label="Highlights · 4"');
    expect(html).toContain("Quote h1");
    expect(html).toContain("Why it matters");
  });

  test("a highlight found in the article is a button; one not found isn't", () => {
    const html = render([
      highlight("found"),
      highlight("lost", { start: undefined, end: undefined, unanchored: true }),
    ]);
    expect(html.match(/<button/g)).toHaveLength(3);
    expect(html).toContain("Not found in the saved article");
  });

  test("a highlight waiting for its article says so", () => {
    const html = render(
      [highlight("w", { start: undefined, end: undefined, unanchored: true })],
      {
        article: undefined,
        processingStatus: { article: { status: "pending" } },
      }
    );
    expect(html).toContain("Waiting for the article…");
    expect(html).not.toContain("Not found in the saved article");
  });
});
