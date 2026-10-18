import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";
import type { CardModalCard } from "../types";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const realFolders = await import("../../../hooks/useFolders");
mock.module("../../../hooks/useFolders", () => ({
  ...realFolders,
  useFolders: () => [],
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CardModal } = await import("../CardModal");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

const card = {
  _id: "card_hub",
  _creationTime: 0,
  colors: [{ hex: "#112233" }],
  content: "#112233",
  createdAt: 0,
  tags: [],
  type: "palette",
  updatedAt: 0,
  userId: "user_1",
} as unknown as CardModalCard;

async function renderModal({
  hasUnsavedChanges,
  onOpenCard,
  saveChanges,
}: {
  hasUnsavedChanges: boolean;
  onOpenCard: (cardId: string) => void;
  saveChanges: () => Promise<boolean>;
}) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() =>
    root?.render(
      <CardModal
        backlinks={{
          backlinks: [{ id: "card_source", title: "Trip notes", type: "text" }],
          hasMore: false,
        }}
        card={card}
        cardId={card._id}
        downloadFile={() => undefined}
        getCurrentValue={() => undefined}
        handleDelete={async () => undefined}
        handlePermanentDelete={async () => undefined}
        handleRestore={async () => undefined}
        hasUnsavedChanges={hasUnsavedChanges}
        onCancel={() => undefined}
        onOpenCard={onOpenCard}
        open
        openLink={() => undefined}
        saveChanges={saveChanges}
        saveState="idle"
        tags={{
          addTag: () => undefined,
          removeAiTag: () => undefined,
          removeTag: () => undefined,
          setTagInput: () => undefined,
          tagInput: "",
        }}
        toggleFavorite={() => undefined}
        updateContent={() => undefined}
        updateNotes={() => undefined}
        updateTitle={() => undefined}
      />
    )
  );
}

const clickBacklink = () =>
  act(async () => {
    document
      .querySelector<HTMLElement>("[aria-label='Linked from'] button")
      ?.click();
    await Promise.resolve();
  });

test("Linked from opens the source card", async () => {
  const onOpenCard = mock();
  const saveChanges = mock(async () => true);
  await renderModal({ hasUnsavedChanges: false, onOpenCard, saveChanges });

  await clickBacklink();
  expect(onOpenCard).toHaveBeenCalledWith("card_source");
  expect(saveChanges).not.toHaveBeenCalled();
});

test("Linked from saves unsaved edits before switching cards", async () => {
  const onOpenCard = mock();
  const saveChanges = mock(async () => true);
  await renderModal({ hasUnsavedChanges: true, onOpenCard, saveChanges });

  await clickBacklink();
  expect(saveChanges).toHaveBeenCalledTimes(1);
  expect(onOpenCard).toHaveBeenCalledWith("card_source");
});

test("Linked from stays on the card when its edits fail to save", async () => {
  const onOpenCard = mock();
  const saveChanges = mock(async () => false);
  await renderModal({ hasUnsavedChanges: true, onOpenCard, saveChanges });

  await clickBacklink();
  expect(saveChanges).toHaveBeenCalledTimes(1);
  expect(onOpenCard).not.toHaveBeenCalled();
});
