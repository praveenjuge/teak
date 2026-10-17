import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { CardModalCard } from "../types";

// The panel lists the user's folders from Convex; none are needed here.
const realFolders = await import("../../../hooks/useFolders");
mock.module("../../../hooks/useFolders", () => ({
  ...realFolders,
  useFolders: () => [],
}));

const { CardMetadataPanel } = await import("../CardMetadataPanel");

const textCard = (extra: Partial<CardModalCard> = {}) =>
  ({
    _id: "card_1",
    _creationTime: 0,
    content: "A line worth keeping",
    createdAt: 0,
    tags: [],
    type: "text",
    updatedAt: 0,
    userId: "user_1",
    ...extra,
  }) as unknown as CardModalCard;

const render = (card: CardModalCard) =>
  renderToStaticMarkup(
    <CardMetadataPanel
      card={card}
      getCurrentValue={(field) => card[field as keyof CardModalCard] as never}
      onCardTypeClick={() => undefined}
      onCommit={() => undefined}
      onNotesChange={() => undefined}
      onPermanentDelete={() => undefined}
      onRestore={() => undefined}
      tags={{
        addTag: () => undefined,
        removeAiTag: () => undefined,
        removeTag: () => undefined,
        setTagInput: () => undefined,
        tagInput: "",
      }}
    />
  );

test("a text card saved from a page links to it from a From row", () => {
  const markup = render(
    textCard({
      sourceTitle: "An essay on keeping things",
      sourceUrl: "https://www.example.com/essay",
    })
  );
  expect(markup).toContain(">From<");
  expect(markup).toContain('href="https://www.example.com/essay"');
  expect(markup).toContain(">example.com</a>");
  expect(markup).toContain("An essay on keeping things");
});

test("a card without a source, or with an unsafe one, has no From row", () => {
  expect(render(textCard())).not.toContain(">From<");
  expect(render(textCard({ sourceUrl: "javascript:alert(1)" }))).not.toContain(
    ">From<"
  );
});

const imageCard = (aiOcrText?: string) =>
  textCard({ aiOcrText, content: "", type: "image" });

test("an image with text shows it in a Text in image block with a copy button", () => {
  const markup = render(imageCard("Invoice 4411\nTotal due"));
  expect(markup).toContain('aria-label="Text in image"');
  expect(markup).toContain("Invoice 4411\nTotal due");
  expect(markup).toContain('aria-label="Copy text in image"');
  expect(markup).toContain('dir="auto"');
  expect(markup).not.toContain(">Show all<");
  expect(markup).not.toContain("line-clamp-6");
});

test("long image text folds to six lines; code keeps a monospace font", () => {
  const long = render(
    imageCard(Array.from({ length: 9 }, (_, line) => `line ${line}`).join("\n"))
  );
  expect(long).toContain("line-clamp-6");
  expect(long).toContain(">Show all<");
  expect(long).not.toContain("font-mono");

  const code = render(
    imageCard("function total(items) {\n  let sum = 0;\n  return sum;\n}")
  );
  expect(code).toContain("font-mono");
});

test("an image without text has no Text in image block", () => {
  expect(render(imageCard())).not.toContain("Text in image");
  expect(render(imageCard("   "))).not.toContain("Text in image");
});
