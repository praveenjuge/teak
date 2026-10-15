import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";
import type { CardModalCard } from "../types";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

// Folders come from Convex; this test is about the panel's own button.
mock.module("../../../hooks/useFolders", () => ({ useFolders: () => [] }));
mock.module("../../folders/CardFoldersDialog", () => ({
  CardFoldersDialog: () => null,
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CardMetadataPanel } = await import("../CardMetadataPanel");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

const render = async (
  card: Partial<CardModalCard>,
  onMoreLikeThis = mock()
) => {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(() => {
    root?.render(
      <CardMetadataPanel
        card={
          {
            _id: "card_1",
            _creationTime: 0,
            content: "A note",
            createdAt: 0,
            tags: [],
            type: "text",
            updatedAt: 0,
            userId: "user_1",
            ...card,
          } as unknown as CardModalCard
        }
        getCurrentValue={() => undefined}
        onCardTypeClick={() => undefined}
        onCommit={() => undefined}
        onMoreLikeThis={onMoreLikeThis}
        onNotesChange={() => undefined}
        onPermanentDelete={() => undefined}
        onRestore={() => undefined}
        tags={
          {
            addTag: () => undefined,
            removeAiTag: () => undefined,
            removeTag: () => undefined,
            setTagInput: () => undefined,
            tagInput: "",
          } as never
        }
      />
    );
  });
  return onMoreLikeThis;
};

const button = () =>
  Array.from(document.querySelectorAll("button")).find(
    (element) => element.textContent === "More like this"
  );

test("More like this opens the card's similar cards", async () => {
  const onMoreLikeThis = await render({});
  expect(button()).toBeDefined();
  await act(() => button()?.click());
  expect(onMoreLikeThis).toHaveBeenCalledTimes(1);
});

test("a card in Trash has no More like this", async () => {
  await render({ isDeleted: true });
  expect(button()).toBeUndefined();
});
