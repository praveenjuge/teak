import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";
import type { CardModalCard, GetCurrentValue } from "../types";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const realPanel = await import("../CardMetadataPanel");
mock.module("../CardMetadataPanel", () => ({
  ...realPanel,
  CardMetadataPanel: () => null,
}));
// The note editor stays on its plain stand-in, as before the editor loads.
mock.module("../../text-editor/LoadedMarkdownTextEditor", () => ({
  default: () => {
    throw new Promise(() => undefined);
  },
}));
let foldersOpen = false;
let menuOpenWithFolders = false;
mock.module("../../folders/CardFoldersDialog", () => ({
  CardFoldersDialog: ({ open }: { open: boolean }) => {
    if (open && !foldersOpen) {
      menuOpenWithFolders = document.querySelector("[role='menu']") !== null;
    }
    foldersOpen = open;
    return null;
  },
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CardModal, emptiedContentNotice } = await import("../CardModal");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

const card = (extra: Partial<CardModalCard> = {}) =>
  ({
    _creationTime: 0,
    _id: "card_1",
    content: "A note",
    createdAt: 0,
    tags: [],
    type: "text",
    updatedAt: 0,
    userId: "user_1",
    ...extra,
  }) as unknown as CardModalCard;

async function render(
  shown: CardModalCard,
  updateContent: (value: string) => void = () => undefined
) {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(() =>
    root?.render(
      <CardModal
        card={shown}
        cardId={shown._id}
        downloadFile={() => undefined}
        getCurrentValue={(field) =>
          shown[field as keyof CardModalCard] as string | undefined
        }
        handleDelete={async () => undefined}
        handlePermanentDelete={async () => undefined}
        handleRestore={async () => undefined}
        hasUnsavedChanges={false}
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
        updateContent={updateContent}
        updateNotes={() => undefined}
        updateTitle={() => undefined}
      />
    )
  );
}

const dialog = () => document.querySelector<HTMLElement>("[role='dialog']");

test("a note in Trash can be read but not edited", async () => {
  const updateContent = mock();
  await render(card({ isDeleted: true }), updateContent);
  const editor = document.querySelector<HTMLTextAreaElement>(
    "textarea[aria-label='Markdown content']"
  );
  expect(editor?.value).toBe("A note");
  expect(editor?.disabled).toBe(true);
  expect(document.querySelector("button[aria-label='Focus']")).toBeNull();
});

test("a note outside Trash stays editable", async () => {
  await render(card());
  const editor = document.querySelector<HTMLTextAreaElement>(
    "textarea[aria-label='Markdown content']"
  );
  expect(editor?.disabled).toBe(false);
  expect(document.querySelector("button[aria-label='Focus']")).not.toBeNull();
});

test("a quote in Trash can be read but not edited", async () => {
  await render(
    card({ content: "Be curious.", isDeleted: true, type: "quote" })
  );
  const quote = Array.from(document.querySelectorAll("textarea")).find(
    (textarea) => textarea.value === "Be curious."
  );
  expect(quote?.readOnly).toBe(true);
});

test("C copies a note's card links as their titles, not their tokens", async () => {
  const writeText = mock(async () => undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  await render(
    card({ content: "See [[Reading list|teak:k17abc123def456gh]] for more" })
  );
  await act(() => {
    dialog()?.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "c" })
    );
  });
  expect(writeText).toHaveBeenCalledWith("See Reading list for more");
});

test("Add to folder from the menu opens once the menu has closed, with focus on the card to come back to", async () => {
  await render(card());
  const trigger = document.querySelector<HTMLButtonElement>(
    "button[aria-label='More actions']"
  );
  await act(() => {
    trigger?.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Enter" })
    );
  });
  const item = Array.from(document.querySelectorAll("[role='menuitem']")).find(
    (element) => element.textContent?.trim() === "Add to folder…"
  ) as HTMLElement | undefined;
  expect(item).toBeDefined();
  item?.focus();
  await act(() => item?.click());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  expect(foldersOpen).toBe(true);
  // A menu still closing took focus back from the dialog in a browser.
  expect(menuOpenWithFolders).toBe(false);
  expect(document.activeElement).toBe(dialog());
});

const contentOf =
  (content: string | undefined): GetCurrentValue =>
  (field) =>
    field === "content" ? content : undefined;

test.each([
  ["text", "Empty notes aren't saved. The note keeps its last text."],
  ["quote", "Empty quotes aren't saved. The quote keeps its last text."],
] as const)("leaving an emptied %s says it isn't saved", (type, notice) => {
  expect(emptiedContentNotice(card({ type }), contentOf("  \n"))).toBe(notice);
});

test("a note with text, or one that was already empty, says nothing", () => {
  expect(emptiedContentNotice(card(), contentOf("Edited"))).toBeNull();
  expect(emptiedContentNotice(card({ content: "" }), contentOf(""))).toBeNull();
  expect(
    emptiedContentNotice(card({ type: "link", content: "x" }), contentOf(""))
  ).toBeNull();
});
