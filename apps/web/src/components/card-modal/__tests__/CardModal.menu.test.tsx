import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";
import type { LinkThumbnailControl } from "../../../hooks/useLinkThumbnail";
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
const { CardModal, DETAILS_HIDDEN_KEY } = await import("../CardModal");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  window.localStorage.clear();
});

const linkCard = (extra: Partial<CardModalCard> = {}) =>
  ({
    _id: "card_1",
    _creationTime: 0,
    content: "",
    createdAt: 0,
    tags: [],
    type: "link",
    updatedAt: 0,
    url: "https://example.com/lamp",
    userId: "user_1",
    ...extra,
  }) as unknown as CardModalCard;

const thumbnailControl = (): LinkThumbnailControl => ({
  isBusy: false,
  replace: mock(),
  reset: mock(),
});

async function render(
  card: CardModalCard,
  {
    linkThumbnail = thumbnailControl(),
    onMoreLikeThis = mock(),
    savePdf,
    handleRestore = mock(async () => undefined),
    openLink = mock(),
    toggleDone,
  }: {
    handleRestore?: (onClose?: () => void) => Promise<void>;
    linkThumbnail?: LinkThumbnailControl;
    onMoreLikeThis?: (cardId: string) => void;
    openLink?: () => void;
    savePdf?: { isSaving: boolean; save: () => void };
    toggleDone?: () => void;
  } = {}
) {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(() =>
    root?.render(
      <CardModal
        card={card}
        cardId={card._id}
        downloadFile={() => undefined}
        getCurrentValue={() => undefined}
        handleDelete={async () => undefined}
        handlePermanentDelete={async () => undefined}
        handleRestore={handleRestore}
        hasUnsavedChanges={false}
        linkThumbnail={linkThumbnail}
        onMoreLikeThis={onMoreLikeThis}
        open
        openLink={openLink}
        saveChanges={async () => true}
        savePdf={savePdf}
        saveState="idle"
        tags={{
          addTag: () => undefined,
          removeAiTag: () => undefined,
          removeTag: () => undefined,
          setTagInput: () => undefined,
          tagInput: "",
        }}
        toggleDone={toggleDone}
        toggleFavorite={() => undefined}
        updateContent={() => undefined}
        updateNotes={() => undefined}
        updateTitle={() => undefined}
      />
    )
  );
  return { handleRestore, linkThumbnail, onMoreLikeThis, openLink, toggleDone };
}

async function openMenu() {
  const trigger = document.querySelector<HTMLButtonElement>(
    "button[aria-label='More actions']"
  );
  await act(() => {
    trigger?.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Enter" })
    );
  });
}

const button = (label: string) =>
  Array.from(document.querySelectorAll("button")).find(
    (item) => item.textContent?.trim() === label
  );

async function press(key: string, init: KeyboardEventInit = {}) {
  const dialog = document.querySelector<HTMLElement>("[role='dialog']");
  await act(() => {
    dialog?.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key, ...init })
    );
  });
}

/** A menu item by its label, leaving out the shortcut beside it. */
const menuItem = (label: string) =>
  Array.from(document.querySelectorAll("[role='menuitem']")).find((item) => {
    const shortcut = item.querySelector(
      "[data-slot='dropdown-menu-shortcut']"
    )?.textContent;
    const text = item.textContent?.trim() ?? "";
    return (shortcut ? text.slice(0, -shortcut.length) : text) === label;
  }) as HTMLElement | undefined;

test("the card menu offers More like this for the open card", async () => {
  const { onMoreLikeThis } = await render(linkCard());
  await openMenu();
  await act(() => menuItem("More like this")?.click());
  expect(onMoreLikeThis).toHaveBeenCalledWith("card_1");
});

test("Replace image in the card menu opens the picker and replaces the image", async () => {
  const { linkThumbnail } = await render(linkCard());
  const input = document.querySelector<HTMLInputElement>(
    "[data-testid='link-image-input']"
  );
  const opened = mock();
  input?.addEventListener("click", opened);
  await openMenu();
  await act(() => menuItem("Replace image")?.click());
  expect(opened).toHaveBeenCalledTimes(1);

  const file = new File([new Uint8Array(8)], "lamp.png", { type: "image/png" });
  Object.defineProperty(input, "files", { value: [file] });
  await act(() => {
    input?.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(linkThumbnail.replace).toHaveBeenCalledWith(file, "pick");
  expect(menuItem("Reset to original image")).toBeUndefined();
});

test("a replaced image can be reset from the card menu", async () => {
  const { linkThumbnail } = await render(
    linkCard({
      thumbnailOverride: {
        storageKey: "users/user_1/cards/link/thumbnail-override/a",
        width: 10,
        height: 10,
        updatedAt: 1,
      },
    } as Partial<CardModalCard>)
  );
  await openMenu();
  await act(() => menuItem("Reset to original image")?.click());
  expect(linkThumbnail.reset).toHaveBeenCalledTimes(1);
});

test("a card in Trash has neither More like this nor image actions", async () => {
  await render(linkCard({ isDeleted: true } as Partial<CardModalCard>));
  await openMenu();
  expect(menuItem("Copy Link")).toBeDefined();
  expect(menuItem("More like this")).toBeUndefined();
  expect(menuItem("Replace image")).toBeUndefined();
});

test("a card in Trash says so above the card, with Restore there and not in the menu", async () => {
  const { handleRestore } = await render(
    linkCard({ isDeleted: true } as Partial<CardModalCard>)
  );
  expect(document.querySelector("[role='status']")?.textContent).toContain(
    "This card is in Trash"
  );
  await openMenu();
  expect(menuItem("Restore")).toBeUndefined();
  expect(menuItem("Delete Forever")).toBeUndefined();
  await act(() => button("Restore")?.click());
  expect(handleRestore).toHaveBeenCalledTimes(1);
});

test("Save PDF lives in the menu, and reads Saving PDF… while it saves", async () => {
  const save = mock();
  await render(linkCard(), { savePdf: { isSaving: false, save } });
  await openMenu();
  await act(() => menuItem("Save PDF")?.click());
  expect(save).toHaveBeenCalledTimes(1);

  await act(() => root?.unmount());
  document.body.innerHTML = "";
  await render(linkCard(), { savePdf: { isSaving: true, save } });
  await openMenu();
  expect(menuItem("Saving PDF…")?.getAttribute("aria-disabled")).toBe("true");
});

test("Hide details in the menu hides the details, and I brings them back", async () => {
  await render(linkCard());
  const aside = () =>
    document.querySelector("aside[aria-label='Card details']");
  await openMenu();
  await act(() => menuItem("Hide details")?.click());
  expect(aside()?.className).toContain("md:hidden");
  expect(window.localStorage.getItem(DETAILS_HIDDEN_KEY)).toBe("1");

  await press("i");
  expect(aside()?.className).not.toContain("md:hidden");
  expect(window.localStorage.getItem(DETAILS_HIDDEN_KEY)).toBe("0");
});

test("I from a control in the details keeps focus in the dialog, so card keys still work", async () => {
  await render(linkCard());
  const aside = document.querySelector("aside[aria-label='Card details']");
  const control = document.createElement("button");
  aside?.append(control);
  control.focus();
  await act(() => {
    control.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "i" })
    );
  });
  expect(aside?.className).toContain("md:hidden");
  expect(document.activeElement).toBe(
    document.querySelector("[role='dialog']")
  );
});

test("O and Mod+Enter open the link, and D marks it done", async () => {
  const toggleDone = mock();
  const { openLink } = await render(linkCard(), { toggleDone });
  await press("o");
  await press("Enter", { ctrlKey: true });
  expect(openLink).toHaveBeenCalledTimes(2);
  await press("d");
  expect(toggleDone).toHaveBeenCalledTimes(1);
});

test("C copies the link", async () => {
  const writeText = mock(async () => undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  await render(linkCard());
  await press("c");
  expect(writeText).toHaveBeenCalledWith("https://example.com/lamp");
});

test("a note has More like this but no image actions", async () => {
  await render(linkCard({ type: "text", url: undefined }));
  await openMenu();
  expect(menuItem("More like this")).toBeDefined();
  expect(menuItem("Replace image")).toBeUndefined();
});

const downloadControls = () =>
  Array.from(document.querySelectorAll("button, [role='menuitem']")).filter(
    (element) => element.textContent?.trim() === "Download"
  );

test.each([
  ["image", true],
  ["video", true],
  ["audio", true],
  ["document", true],
  ["text", false],
  ["link", false],
] as const)(
  "a %s card with a stored file offers Download: %p",
  async (type, offered) => {
    await render(
      linkCard({
        fileKey: "users/user_1/cards/card_1/file",
        type,
        url: undefined,
      } as Partial<CardModalCard>)
    );
    await openMenu();
    expect(downloadControls().length > 0).toBe(offered);
  }
);

test("a file card with nothing stored offers no Download", async () => {
  await render(linkCard({ type: "image", url: undefined }));
  await openMenu();
  expect(downloadControls()).toEqual([]);
});
