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

const pressEscape = () =>
  act(async () => {
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Escape",
      })
    );
    await Promise.resolve();
  });

test("one Escape closes the card even while a tooltip is open", async () => {
  const onCancel = mock();
  await renderModal({
    card: paletteCard("card_a", "#112233"),
    onCancel,
    open: true,
  });
  // A real Radix tooltip: a dismissable layer above the dialog, as one
  // keyboard focus opens on an action button.
  const { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } =
    await import("@/components/ui/tooltip");
  const tooltipRoot = createRoot(
    document.body.appendChild(document.createElement("div"))
  );
  await act(() =>
    tooltipRoot.render(
      <TooltipProvider>
        <Tooltip open>
          <TooltipTrigger>Favorite</TooltipTrigger>
          <TooltipContent>Favorite F</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  );
  expect(
    document.querySelector("[data-slot='tooltip-content']")
  ).not.toBeNull();

  await pressEscape();
  expect(onCancel).toHaveBeenCalledTimes(1);
  await act(() => tooltipRoot.unmount());
});

test("Escape over a menu on the card is left to the menu", async () => {
  const onCancel = mock();
  await renderModal({
    card: paletteCard("card_a", "#112233"),
    onCancel,
    open: true,
  });
  const tooltip = document.createElement("div");
  tooltip.dataset.slot = "tooltip-content";
  const menu = document.createElement("div");
  menu.setAttribute("role", "menu");
  menu.dataset.state = "open";
  document.body.append(tooltip, menu);

  const { escapeClosesOverTooltip } = await import("../cardModalKeys");
  expect(escapeClosesOverTooltip(dialog())).toBe(false);
  menu.remove();
  expect(escapeClosesOverTooltip(dialog())).toBe(true);
  tooltip.remove();
  expect(escapeClosesOverTooltip(dialog())).toBe(false);
});
