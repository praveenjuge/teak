import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";
import type { CardModalCard } from "../types";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const realConvexReact = await import("convex/react");
mock.module("convex/react", () => ({
  ...realConvexReact,
  useConvex: () => ({}),
  useMutation: () =>
    Object.assign(async () => null, {
      withOptimisticUpdate: () => async () => null,
    }),
  useQuery: () => undefined,
}));
const realCacheHooks = await import("convex-helpers/react/cache/hooks");
mock.module("convex-helpers/react/cache/hooks", () => ({
  ...realCacheHooks,
  useQuery: () => undefined,
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

const card = (extra: Record<string, unknown> = {}) =>
  ({
    _id: "card_1",
    _creationTime: 0,
    content: "",
    createdAt: 0,
    tags: [],
    type: "link",
    updatedAt: 0,
    url: "https://example.com/story",
    userId: "user_1",
    ...extra,
  }) as unknown as CardModalCard;

const inCategory = (category: string | undefined, extra = {}) =>
  card({
    ...(category
      ? {
          metadata: {
            linkCategory: {
              category,
              fetchedAt: 1,
              sourceUrl: "https://example.com/story",
            },
          },
        }
      : {}),
    ...extra,
  });

const dialog = (shown: CardModalCard, toggleDone?: () => void) => (
  <CardModal
    card={shown}
    cardId={shown._id}
    downloadFile={() => undefined}
    getCurrentValue={() => undefined}
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
    toggleDone={toggleDone}
    toggleFavorite={() => undefined}
    updateContent={() => undefined}
    updateNotes={() => undefined}
    updateTitle={() => undefined}
  />
);

async function render(shown: CardModalCard, toggleDone?: () => void) {
  if (root) {
    // Re-render the open dialog with the next card, as stepping does.
    await act(() => root?.render(dialog(shown, toggleDone)));
    return;
  }
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(() => root?.render(dialog(shown, toggleDone)));
}

const ARTICLE = {
  extractedAt: 2,
  imageKeys: [],
  readingMinutes: 3,
  status: "ready",
  textKey: "users/u/cards/card_1/article-text/a.md",
  wordCount: 640,
};

const toggleItems = () =>
  Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      '[data-slot="toggle-group-item"]'
    )
  );

const selectedView = () =>
  toggleItems()
    .find((item) => item.getAttribute("data-state") === "on")
    ?.textContent?.trim();

const press = async (key: string) => {
  const main = document.querySelector("main");
  await act(() => {
    main?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key }));
  });
};

test("the Preview · Read toggle shows only for a link with an article, or one on its way", async () => {
  await render(inCategory("article"));
  expect(toggleItems()).toEqual([]);

  await render(
    inCategory("article", { article: { extractedAt: 1, status: "none" } })
  );
  expect(toggleItems()).toEqual([]);

  await render(inCategory("article", { article: ARTICLE }));
  expect(toggleItems().map((item) => item.textContent?.trim())).toEqual([
    "Preview",
    "Read",
  ]);
});

test.each([
  ["article", "Read"],
  ["news", "Read"],
  ["research", "Read"],
  ["product", "Preview"],
  [undefined, "Preview"],
])("a %s link opens on %s", async (category, view) => {
  await render(inCategory(category, { article: ARTICLE }));
  expect(selectedView()).toBe(view);
});

test("R toggles between them, and the choice doesn't carry over to the next card", async () => {
  await render(inCategory("product", { article: ARTICLE }));
  expect(selectedView()).toBe("Preview");

  await press("r");
  expect(selectedView()).toBe("Read");
  await press("r");
  expect(selectedView()).toBe("Preview");
  await press("r");
  expect(selectedView()).toBe("Read");

  await render(
    inCategory("product", {
      _id: "card_2",
      article: ARTICLE,
      url: "https://example.com/other",
    })
  );
  expect(selectedView()).toBe("Preview");
});

test("an article being prepared shows its Read tab with the preparing line", async () => {
  await render(
    inCategory("news", { processingStatus: { article: { status: "pending" } } })
  );
  expect(selectedView()).toBe("Read");
  expect(document.body.textContent).toContain("Preparing the article…");
});
