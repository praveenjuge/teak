import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";
import type { CardModalCard } from "../types";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

// Convex is the boundary: the side panel's folder and tag reads stay
// loading, and the header's done button is what these tests cover.
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

async function render(shown: CardModalCard, toggleDone?: () => void) {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(() =>
    root?.render(
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
    )
  );
}

const doneButton = () =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) =>
      button.hasAttribute("aria-pressed") &&
      button.getAttribute("aria-label") !== "Favorite" &&
      button.getAttribute("aria-label") !== "Unfavorite"
  );

test.each([
  ["book", "Mark as read", "Read"],
  ["article", "Mark as read", "Read"],
  ["movie", "Mark as watched", "Watched"],
  ["podcast", "Mark as listened", "Listened"],
  ["product", "Mark as bought", "Bought"],
  ["recipe", "Mark as cooked", "Cooked"],
  ["game", "Mark as played", "Played"],
  ["app", "Mark as done", "Done"],
  ["a-category-from-the-future", "Mark as done", "Done"],
  [undefined, "Mark as done", "Done"],
])("a %p link reads %p, then %p once done", async (category, notDone, done) => {
  await render(inCategory(category), () => undefined);
  expect(doneButton()?.getAttribute("aria-label")).toBe(notDone);
  expect(doneButton()?.getAttribute("aria-pressed")).toBe("false");

  await act(() => root?.unmount());
  document.body.innerHTML = "";
  await render(inCategory(category, { completedAt: 1 }), () => undefined);
  expect(doneButton()?.getAttribute("aria-label")).toBe(done);
  expect(doneButton()?.getAttribute("aria-pressed")).toBe("true");
});

test("clicking it toggles the card", async () => {
  const toggleDone = mock();
  await render(inCategory("movie"), toggleDone);
  await act(() => doneButton()?.click());
  expect(toggleDone).toHaveBeenCalledTimes(1);
});

test.each([
  ["a note", card({ type: "text", url: undefined })],
  ["a link in Trash", inCategory("movie", { isDeleted: true })],
])("%s has no done button", async (_name, shown) => {
  await render(shown, () => undefined);
  expect(doneButton()).toBeUndefined();
});
