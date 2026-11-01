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
let panelProps: Parameters<typeof realPanel.CardMetadataPanel>[0] | undefined;
mock.module("../CardMetadataPanel", () => ({
  ...realPanel,
  CardMetadataPanel: (props: typeof panelProps) => {
    panelProps = props;
    return null;
  },
}));

let reportActionsVisible: ((visible: boolean) => void) | undefined;
class FakeIntersectionObserver {
  readonly callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }
  observe() {
    reportActionsVisible = (visible) =>
      this.callback(
        [
          {
            boundingClientRect: { bottom: visible ? 200 : -10 },
            isIntersecting: visible,
            rootBounds: { top: 0 },
          } as unknown as IntersectionObserverEntry,
        ],
        this as unknown as IntersectionObserver
      );
  }
  disconnect() {
    reportActionsVisible = undefined;
  }
}
Object.assign(globalThis, { IntersectionObserver: FakeIntersectionObserver });

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CardModal } = await import("../CardModal");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  panelProps = undefined;
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
    handleDelete = mock(async () => undefined),
    handleRestore = mock(async () => undefined),
    openLink = mock(),
    toggleArchive,
    toggleDone,
  }: {
    handleDelete?: (onClose?: () => void) => Promise<void>;
    handleRestore?: (onClose?: () => void) => Promise<void>;
    linkThumbnail?: LinkThumbnailControl;
    onMoreLikeThis?: (cardId: string) => void;
    openLink?: () => void;
    savePdf?: { isSaving: boolean; save: () => void };
    toggleArchive?: () => void;
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
        handleDelete={handleDelete}
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
        toggleArchive={toggleArchive}
        toggleDone={toggleDone}
        toggleFavorite={() => undefined}
        updateContent={() => undefined}
        updateNotes={() => undefined}
        updateTitle={() => undefined}
      />
    )
  );
  return {
    handleDelete,
    handleRestore,
    linkThumbnail,
    onMoreLikeThis,
    openLink,
    toggleArchive,
    toggleDone,
  };
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

const menuItemLabel = (item: HTMLElement) => {
  const shortcut = item.querySelector(
    "[data-slot='dropdown-menu-shortcut']"
  )?.textContent;
  const text = item.textContent?.trim() ?? "";
  return shortcut ? text.slice(0, -shortcut.length) : text;
};

const menuItem = (label: string) =>
  Array.from(document.querySelectorAll<HTMLElement>("[role='menuitem']")).find(
    (item) => menuItemLabel(item) === label
  );

test("the card menu offers More like this for the open card", async () => {
  const { onMoreLikeThis } = await render(linkCard());
  await openMenu();
  await act(() => menuItem("More like this")?.click());
  expect(onMoreLikeThis).toHaveBeenCalledWith("card_1");
});

test("Replace image in Details opens the picker and replaces the image", async () => {
  const { linkThumbnail } = await render(linkCard());
  const input = document.querySelector<HTMLInputElement>(
    "[data-testid='link-image-input']"
  );
  const opened = mock();
  input?.addEventListener("click", opened);
  await act(() => panelProps?.image?.onReplace());
  expect(opened).toHaveBeenCalledTimes(1);

  const file = new File([new Uint8Array(8)], "lamp.png", { type: "image/png" });
  Object.defineProperty(input, "files", { value: [file] });
  await act(() => {
    input?.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(linkThumbnail.replace).toHaveBeenCalledWith(file, "pick");
  expect(panelProps?.image?.onReset).toBeUndefined();
  await openMenu();
  expect(menuItem("Replace image")).toBeUndefined();
});

test("a replaced image can be reset from Details", async () => {
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
  await act(() => panelProps?.image?.onReset?.());
  expect(linkThumbnail.reset).toHaveBeenCalledTimes(1);
});

test("Edit link sits beside the link's URL in Details, not in the menu", async () => {
  await render(linkCard());
  expect(panelProps?.onEditLink).toBeDefined();
  await openMenu();
  expect(menuItem("Edit link…")).toBeUndefined();
});

test("a card in Trash has no actions, menu, Edit link or image actions", async () => {
  await render(linkCard({ isDeleted: true } as Partial<CardModalCard>));
  expect(
    document.querySelector("button[aria-label='More actions']")
  ).toBeNull();
  expect(document.querySelector("button[aria-label='Favorite']")).toBeNull();
  expect(button("Open")).toBeUndefined();
  expect(panelProps?.onEditLink).toBeUndefined();
  expect(panelProps?.image).toBeUndefined();
});

test("a card in Trash says so in the sidebar, with Restore and Delete forever", async () => {
  const { handleRestore } = await render(
    linkCard({ isDeleted: true } as Partial<CardModalCard>)
  );
  const status = document.querySelector("aside [role='status']");
  expect(status?.textContent).toContain("This card is in Trash");
  expect(button("Delete forever")).toBeDefined();
  await act(() => button("Restore")?.click());
  expect(handleRestore).toHaveBeenCalledTimes(1);
});

test("the sidebar leads with the title, then Open and the icon row", async () => {
  await render(
    linkCard({ metadataTitle: "A lamp" } as Partial<CardModalCard>),
    {
      toggleDone: mock(),
    }
  );
  const aside = document.querySelector("aside[aria-label='Card details']");
  expect(aside?.querySelector("textarea[aria-label='Title']")).toBeTruthy();
  expect(aside?.querySelector("h2")?.textContent).toBe("A lamp");
  expect(aside?.textContent).toContain("example.com");
  const controls = Array.from(
    aside?.querySelectorAll("button[aria-keyshortcuts], button[aria-label]") ??
      []
  ).map((item) => item.getAttribute("aria-label") ?? item.textContent?.trim());
  expect(controls.slice(0, 6)).toEqual([
    "Open",
    "Favorite",
    "Mark as done",
    "Copy link",
    "Add to folder…",
    "More actions",
  ]);
  expect(document.querySelector("[role='dialog'] header")).toBeNull();
});

test("the menu keeps only what the icon row doesn't hold", async () => {
  await render(linkCard(), { toggleDone: mock() });
  await openMenu();
  const items = Array.from(document.querySelectorAll("[role='menuitem']"));
  const labels = items.map((item) => menuItemLabel(item as HTMLElement));
  expect(labels).toEqual(["More like this", "Move to Trash"]);
});

test("once the actions scroll away, a one-line copy stays pinned on top", async () => {
  await render(linkCard());
  const pinned = () =>
    document.querySelector("[data-testid='pinned-card-actions']");
  expect(pinned()).toBeNull();
  expect(reportActionsVisible).toBeDefined();
  await act(() => reportActionsVisible?.(false));
  expect(pinned()).not.toBeNull();
  expect(pinned()?.querySelector("button[aria-label='Favorite']")).toBeTruthy();
  expect(button("Open")).toBeDefined();
  await act(() => reportActionsVisible?.(true));
  expect(pinned()).toBeNull();
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

test("the details stay beside the card: I does nothing and the menu can't hide them", async () => {
  await render(linkCard());
  const aside = document.querySelector("aside[aria-label='Card details']");
  await press("i");
  expect(aside?.className).not.toContain("hidden");
  await openMenu();
  expect(menuItem("Hide details")).toBeUndefined();
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

test("a file card in Trash still offers Download beside Restore", async () => {
  await render(
    linkCard({
      fileKey: "users/user_1/cards/card_1/file",
      isDeleted: true,
      type: "image",
      url: undefined,
    } as Partial<CardModalCard>)
  );
  const aside = document.querySelector("aside[aria-label='Card details']");
  const download = Array.from(aside?.querySelectorAll("button") ?? []).find(
    (element) => element.textContent?.trim() === "Download"
  );
  expect(download).toBeDefined();
  expect(button("Restore")).toBeDefined();
});

test("a file card with nothing stored offers no Download", async () => {
  await render(linkCard({ type: "image", url: undefined }));
  await openMenu();
  expect(downloadControls()).toEqual([]);
});

test.each([
  ["e", "toggleArchive"],
  ["Delete", "handleDelete"],
  ["Backspace", "handleDelete"],
] as const)(
  "pressing %p in the open menu runs %s and closes the menu",
  async (key, handler) => {
    const spies = await render(linkCard(), {
      handleDelete: mock(async () => undefined),
      toggleArchive: mock(),
    });
    await openMenu();
    const menu = document.querySelector<HTMLElement>("[role='menu']");
    expect(menu).not.toBeNull();
    await act(() => {
      menu?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key })
      );
    });
    expect(spies[handler]).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[role='menu']")).toBeNull();
  }
);
