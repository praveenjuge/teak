import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";
import type { CardModalCard } from "../types";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const realPanel = await import("../CardMetadataPanel");
mock.module("../CardMetadataPanel", () => ({
  ...realPanel,
  CardMetadataPanel: () => null,
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

const paletteCard = (id: string, hex: string) =>
  ({
    _id: id,
    _creationTime: 0,
    colors: [{ hex }],
    content: hex,
    createdAt: 0,
    tags: [],
    type: "palette",
    updatedAt: 0,
    userId: "user_1",
  }) as unknown as CardModalCard;

function renderModal(props: {
  card: CardModalCard | null;
  onCancel: () => void;
  open: boolean;
}) {
  const element = (
    <CardModal
      card={props.card}
      cardId={props.card?._id ?? null}
      downloadFile={() => undefined}
      getCurrentValue={() => undefined}
      handleDelete={async () => undefined}
      handlePermanentDelete={async () => undefined}
      handleRestore={async () => undefined}
      hasUnsavedChanges={false}
      onCancel={props.onCancel}
      open={props.open}
      openLink={() => undefined}
      saveChanges={async () => true}
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
  );
  if (!root) {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  return act(() => root?.render(element));
}

const dialog = () => document.querySelector("[role='dialog']");

const closeButton = () =>
  dialog()?.querySelector<HTMLButtonElement>("button[aria-label='Close']");

test("closing tells the page, which closes the dialog", async () => {
  const onCancel = mock();
  await renderModal({
    card: paletteCard("card_a", "#112233"),
    onCancel,
    open: true,
  });

  await act(() => {
    closeButton()?.click();
  });
  expect(onCancel).toHaveBeenCalledTimes(1);

  await renderModal({ card: null, onCancel, open: false });
  expect(dialog()).toBeNull();
});

test("opens again after a close", async () => {
  const onCancel = mock();
  await renderModal({
    card: paletteCard("card_a", "#112233"),
    onCancel,
    open: true,
  });
  await act(() => {
    closeButton()?.click();
  });

  await renderModal({ card: null, onCancel, open: false });
  await renderModal({
    card: paletteCard("card_b", "#445566"),
    onCancel,
    open: true,
  });

  expect(dialog()?.textContent).toContain("#445566");
});
