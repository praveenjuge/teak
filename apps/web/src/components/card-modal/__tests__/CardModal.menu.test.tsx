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
const { CardModal } = await import("../CardModal");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
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
  }: {
    linkThumbnail?: LinkThumbnailControl;
    onMoreLikeThis?: (cardId: string) => void;
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
        handleRestore={async () => undefined}
        hasUnsavedChanges={false}
        linkThumbnail={linkThumbnail}
        onMoreLikeThis={onMoreLikeThis}
        open
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
    )
  );
  return { linkThumbnail, onMoreLikeThis };
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

const menuItem = (label: string) =>
  Array.from(document.querySelectorAll("[role='menuitem']")).find(
    (item) => item.textContent?.trim() === label
  ) as HTMLElement | undefined;

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
  expect(menuItem("Restore")).toBeDefined();
  expect(menuItem("More like this")).toBeUndefined();
  expect(menuItem("Replace image")).toBeUndefined();
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
