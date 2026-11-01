import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { CardModalCard } from "../types";

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
      onCommit={() => undefined}
      onNotesChange={() => undefined}
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
