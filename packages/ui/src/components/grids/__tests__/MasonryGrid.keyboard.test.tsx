import { afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost:3000" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

// Convex is the external boundary: cards and the folder dialogs only need
// hooks that these tests never call.
const realConvexReact = await import("convex/react");
const mutation = () =>
  Object.assign(mock(), { withOptimisticUpdate: () => mock() });
mock.module("convex/react", () => ({
  ...realConvexReact,
  useAction: () => mock(),
  useMutation: mutation,
}));
mock.module("convex-helpers/react/cache/hooks", () => ({
  useQuery: () => undefined,
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MasonryGrid } = await import("../MasonryGrid");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

const card = (id: string, content: string) =>
  ({
    _creationTime: 1,
    _id: id,
    content,
    createdAt: 1,
    type: "text",
    updatedAt: 1,
    userId: "user_123",
  }) as any;

const CARDS = [card("card_a", "First card"), card("card_b", "Second card")];

async function renderGrid(props: Record<string, unknown>) {
  const handlers = {
    onBulkAction: mock(async () => ({ failedIds: [] as string[] })),
    onCardClick: mock(),
    onDeleteCard: mock(async () => true),
    onPermanentDeleteCard: mock(),
    onToggleArchive: mock(),
    onToggleFavorite: mock(),
  };
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() =>
    root?.render(
      <MasonryGrid columns={1} filteredCards={CARDS} {...handlers} {...props} />
    )
  );
  const cardElement = (id: string) => {
    const element = container.querySelector<HTMLElement>(
      `[data-card-id="${id}"]`
    );
    expect(element).not.toBeNull();
    return element as HTMLElement;
  };
  return { cardElement, handlers };
}

const press = async (element: HTMLElement, key: string) => {
  await act(() => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key })
    );
  });
};

describe("MasonryGrid keyboard actions", () => {
  test("the grid is one tab stop, on its first card", async () => {
    const { cardElement } = await renderGrid({});
    expect(cardElement("card_a").tabIndex).toBe(0);
    expect(cardElement("card_b").tabIndex).toBe(-1);
  });

  test("F, E and Delete act on the focused card", async () => {
    const { cardElement, handlers } = await renderGrid({});
    const first = cardElement("card_a");
    await press(first, "f");
    await press(first, "e");
    await press(first, "Delete");
    expect(handlers.onToggleFavorite).toHaveBeenCalledWith("card_a");
    expect(handlers.onToggleArchive).toHaveBeenCalledWith("card_a", true);
    expect(handlers.onDeleteCard).toHaveBeenCalledWith("card_a");
  });

  test("with cards selected, Delete moves the selection to Trash", async () => {
    const { cardElement, handlers } = await renderGrid({});
    await press(cardElement("card_a"), "x");
    await press(cardElement("card_b"), "x");
    // The selection checkboxes are decoration, not extra Tab stops.
    const checkboxes = document.querySelectorAll<HTMLElement>(
      "[data-card-shell] [role='checkbox']"
    );
    expect(checkboxes.length).toBe(2);
    for (const checkbox of checkboxes) {
      expect(checkbox.tabIndex).toBe(-1);
    }
    await press(cardElement("card_b"), "Delete");
    expect(handlers.onDeleteCard).not.toHaveBeenCalled();
    expect(handlers.onBulkAction).toHaveBeenCalledTimes(1);
    const [action, cardIds] = handlers.onBulkAction.mock
      .calls[0] as unknown as [string, string[]];
    expect(action).toBe("delete");
    expect(new Set(cardIds)).toEqual(new Set(["card_a", "card_b"]));
  });

  test("choosing cards for a folder ignores F, E and Delete", async () => {
    const { cardElement, handlers } = await renderGrid({
      addToFolder: { id: "folder_1", name: "Reading" },
    });
    const first = cardElement("card_a");
    for (const key of ["f", "e", "Delete", "Backspace"]) {
      await press(first, key);
    }
    expect(handlers.onToggleFavorite).not.toHaveBeenCalled();
    expect(handlers.onToggleArchive).not.toHaveBeenCalled();
    expect(handlers.onDeleteCard).not.toHaveBeenCalled();
    expect(handlers.onBulkAction).not.toHaveBeenCalled();
    // X still picks cards.
    await press(first, "x");
    expect(first.getAttribute("aria-pressed")).toBe("true");
  });

  const asksToDeleteForever = () =>
    document.body.textContent?.includes("Delete this card forever?") ?? false;

  test("in Trash, Delete asks to delete the focused card forever", async () => {
    const { cardElement } = await renderGrid({ showTrashOnly: true });
    await press(cardElement("card_a"), "Delete");
    expect(asksToDeleteForever()).toBe(true);
  });

  test("in Trash, Delete with cards selected does nothing", async () => {
    const { cardElement, handlers } = await renderGrid({ showTrashOnly: true });
    await press(cardElement("card_a"), "x");
    await press(cardElement("card_b"), "x");
    await press(cardElement("card_b"), "Delete");
    expect(asksToDeleteForever()).toBe(false);
    expect(handlers.onBulkAction).not.toHaveBeenCalled();
  });
});
