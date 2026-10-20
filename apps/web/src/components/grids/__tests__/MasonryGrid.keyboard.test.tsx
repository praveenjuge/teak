import { afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost:3000" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

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
const { createRef } = await import("react");
const { MasonryGrid } = await import("../MasonryGrid");
type MasonryGridHandle = import("../MasonryGrid").MasonryGridHandle;

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

const waitFor = async (done: () => boolean) => {
  for (let attempt = 0; attempt < 100 && !done(); attempt++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
};

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

  test("T adds tags to the focused card", async () => {
    const onAddTags = mock();
    const { cardElement } = await renderGrid({ onAddTags });
    await press(cardElement("card_b"), "t");
    expect(onAddTags).toHaveBeenCalledWith("card_b");
  });

  test("with cards selected, T adds tags to all of them", async () => {
    const onAddTags = mock();
    const { cardElement } = await renderGrid({ onAddTags });
    await press(cardElement("card_a"), "x");
    await press(cardElement("card_b"), "x");
    await press(cardElement("card_b"), "t");
    expect(onAddTags).not.toHaveBeenCalled();
    await waitFor(
      () => document.body.textContent?.includes("Add tags to 2 cards") ?? false
    );
    expect(document.body.textContent).toContain("Add tags to 2 cards");
  });

  test("in Trash, T does not add tags", async () => {
    const onAddTags = mock();
    const { cardElement } = await renderGrid({
      onAddTags,
      showTrashOnly: true,
    });
    await press(cardElement("card_a"), "t");
    expect(onAddTags).not.toHaveBeenCalled();
  });

  test("with cards selected, Delete moves the selection to Trash", async () => {
    const { cardElement, handlers } = await renderGrid({});
    await press(cardElement("card_a"), "x");
    await press(cardElement("card_b"), "x");
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

  test("choosing cards for a folder ignores F, T, E and Delete", async () => {
    const onAddTags = mock();
    const { cardElement, handlers } = await renderGrid({
      addToFolder: { id: "folder_1", name: "Reading" },
      onAddTags,
    });
    const first = cardElement("card_a");
    for (const key of ["f", "t", "e", "Delete", "Backspace"]) {
      await press(first, key);
    }
    expect(handlers.onToggleFavorite).not.toHaveBeenCalled();
    expect(onAddTags).not.toHaveBeenCalled();
    expect(handlers.onToggleArchive).not.toHaveBeenCalled();
    expect(handlers.onDeleteCard).not.toHaveBeenCalled();
    expect(handlers.onBulkAction).not.toHaveBeenCalled();
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

  test("a dialog opened from the grid returns focus to the card it showed last", async () => {
    const ref = createRef<MasonryGridHandle>();
    const { cardElement, handlers } = await renderGrid({ ref });
    await press(cardElement("card_a"), "Enter");
    expect(handlers.onCardClick).toHaveBeenCalledTimes(1);

    let returned = false;
    await act(() => {
      returned = ref.current?.returnFocusTo("card_b") ?? false;
    });
    expect(returned).toBe(true);
    expect(document.activeElement).toBe(cardElement("card_b"));
    expect(cardElement("card_b").tabIndex).toBe(0);
    expect(ref.current?.returnFocusTo("card_b")).toBe(false);
  });

  test("leaves focus to a dialog the grid did not open", async () => {
    const ref = createRef<MasonryGridHandle>();
    await renderGrid({ ref });
    expect(ref.current?.returnFocusTo("card_a")).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });
});
