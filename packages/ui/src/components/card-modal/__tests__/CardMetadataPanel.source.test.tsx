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

const render = (
  card: CardModalCard,
  savePdf?: { isSaving: boolean; save: () => void }
) =>
  renderToStaticMarkup(
    <CardMetadataPanel
      card={card}
      getCurrentValue={(field) => card[field as keyof CardModalCard] as never}
      onCardTypeClick={() => undefined}
      onCommit={() => undefined}
      onNotesChange={() => undefined}
      onPermanentDelete={() => undefined}
      onRestore={() => undefined}
      savePdf={savePdf}
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

// Which cards get Save PDF is up to ConnectedCardModal; the panel shows the
// control it is given.
test("a Save PDF control shows Save PDF, and Saving PDF… while it saves", () => {
  const paper = textCard({ type: "link", url: "https://arxiv.org/abs/1" });
  const idle = render(paper, { isSaving: false, save: () => undefined });
  expect(idle).toContain("Save PDF");
  expect(idle).not.toContain('disabled=""');

  const saving = render(paper, { isSaving: true, save: () => undefined });
  expect(saving).toContain("Saving PDF…");
  expect(saving).toContain('aria-busy="true"');
  expect(saving).toContain('disabled=""');
});

test("without a Save PDF control, or in Trash, there is no Save PDF", () => {
  expect(render(textCard({ type: "link" }))).not.toContain("Save PDF");
  expect(
    render(textCard({ type: "link", isDeleted: true }), {
      isSaving: false,
      save: () => undefined,
    })
  ).not.toContain("Save PDF");
});
