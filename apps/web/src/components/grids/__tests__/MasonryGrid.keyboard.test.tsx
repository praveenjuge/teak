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
    onCardAction: mock(),
    onCardClick: mock(),
    onDeleteForever: mock(async () => ({ failedIds: [] as string[] })),
  };
  // Trash lists the cards that were deleted.
  const cards =
    props.view === "trash"
      ? CARDS.map((item) => ({ ...item, isDeleted: true }))
      : CARDS;
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() =>
    root?.render(
      <MasonryGrid filteredCards={cards} resetKey="" {...handlers} {...props} />
    )
  );
  const cardElement = (id: string) => {
    const element = container.querySelector<HTMLElement>(
      `[data-card-id="${id}"]`
    );
    expect(element).not.toBeNull();
    return element as HTMLElement;
  };
  // What the grid handed up for each card action: [action, card id, source].
  const actionsRun = () =>
    handlers.onCardAction.mock.calls.map((call) => {
      const [action, target, source] = call as unknown as [
        string,
        { _id: string },
        string,
      ];
      return [action, target._id, source];
    });
  return { actionsRun, cardElement, handlers };
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
    const { actionsRun, cardElement } = await renderGrid({});
    const first = cardElement("card_a");
    await press(first, "f");
    await press(first, "e");
    await press(first, "Delete");
    expect(actionsRun()).toEqual([
      ["favorite", "card_a", "shortcut"],
      ["archive", "card_a", "shortcut"],
      ["moveToTrash", "card_a", "shortcut"],
    ]);
  });

  test("T adds tags to the focused card", async () => {
    const { actionsRun, cardElement } = await renderGrid({});
    await press(cardElement("card_b"), "t");
    expect(actionsRun()).toEqual([["addTags", "card_b", "shortcut"]]);
  });

  test("with cards selected, T adds tags to all of them", async () => {
    const { actionsRun, cardElement } = await renderGrid({});
    await press(cardElement("card_a"), "x");
    await press(cardElement("card_b"), "x");
    await press(cardElement("card_b"), "t");
    expect(actionsRun()).toEqual([]);
    await waitFor(
      () => document.body.textContent?.includes("Add tags to 2 cards") ?? false
    );
    expect(document.body.textContent).toContain("Add tags to 2 cards");
  });

  test("in Trash, T does not add tags", async () => {
    const { actionsRun, cardElement } = await renderGrid({ view: "trash" });
    await press(cardElement("card_a"), "t");
    expect(actionsRun()).toEqual([]);
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
    expect(handlers.onCardAction).not.toHaveBeenCalled();
    expect(handlers.onBulkAction).toHaveBeenCalledTimes(1);
    const [action, cardIds] = handlers.onBulkAction.mock
      .calls[0] as unknown as [string, string[]];
    expect(action).toBe("delete");
    expect(new Set(cardIds)).toEqual(new Set(["card_a", "card_b"]));
  });

  test("choosing cards for a folder ignores F, T, E and Delete", async () => {
    const { actionsRun, cardElement, handlers } = await renderGrid({
      addToFolder: { id: "folder_1", name: "Reading" },
    });
    const first = cardElement("card_a");
    for (const key of ["f", "t", "e", "p", "Delete", "Backspace"]) {
      await press(first, key);
    }
    expect(actionsRun()).toEqual([]);
    expect(handlers.onBulkAction).not.toHaveBeenCalled();
    await press(first, "x");
    expect(first.getAttribute("aria-pressed")).toBe("true");
  });

  const asksToDeleteForever = () =>
    document.body.textContent?.includes("Delete this card forever?") ?? false;

  test("in Trash, Delete asks to delete the focused card forever", async () => {
    const { cardElement } = await renderGrid({ view: "trash" });
    await press(cardElement("card_a"), "Delete");
    expect(asksToDeleteForever()).toBe(true);
  });

  test("in Trash, Delete with cards selected asks to delete them all forever", async () => {
    const onDeleteForever = mock(async () => ({ failedIds: [] }));
    const { cardElement, handlers } = await renderGrid({
      onDeleteForever,
      view: "trash",
    });
    await press(cardElement("card_a"), "x");
    await press(cardElement("card_b"), "x");
    await press(cardElement("card_b"), "Delete");
    expect(asksToDeleteForever()).toBe(false);
    await waitFor(
      () =>
        document.body.textContent?.includes("Delete 2 cards forever?") ?? false
    );
    expect(document.body.textContent).toContain(
      "This permanently deletes 2 cards and their files."
    );
    expect(handlers.onBulkAction).not.toHaveBeenCalled();
    const confirm = [
      ...document.querySelectorAll<HTMLButtonElement>(
        "[role='alertdialog'] button"
      ),
    ].find((button) => button.textContent?.trim() === "Delete forever");
    expect(confirm).toBeDefined();
    await act(() => confirm?.click());
    expect(onDeleteForever).toHaveBeenCalledTimes(1);
    const [cardIds] = onDeleteForever.mock.calls[0] as unknown as [string[]];
    expect(new Set(cardIds)).toEqual(new Set(["card_a", "card_b"]));
  });

  test("cards that couldn't be deleted forever stay selected to try again", async () => {
    const onDeleteForever = mock(async () => ({
      failedIds: ["card_b"],
    }));
    const { cardElement } = await renderGrid({
      onDeleteForever,
      view: "trash",
    });
    await press(cardElement("card_a"), "x");
    await press(cardElement("card_b"), "x");
    await press(cardElement("card_b"), "Delete");
    await waitFor(
      () =>
        document.body.textContent?.includes("Delete 2 cards forever?") ?? false
    );
    const confirm = [
      ...document.querySelectorAll<HTMLButtonElement>(
        "[role='alertdialog'] button"
      ),
    ].find((button) => button.textContent?.trim() === "Delete forever");
    await act(async () => {
      confirm?.click();
      await Promise.resolve();
    });
    await waitFor(
      () => document.body.textContent?.includes("1 card selected") ?? false
    );
    expect(cardElement("card_b").getAttribute("aria-pressed")).toBe("true");
    expect(cardElement("card_a").getAttribute("aria-pressed")).toBe("false");
  });

  test("a Delete forever that fails outright keeps every card selected", async () => {
    const onDeleteForever = mock(() => Promise.reject(new Error("network")));
    const { cardElement } = await renderGrid({
      onDeleteForever,
      view: "trash",
    });
    await press(cardElement("card_a"), "x");
    await press(cardElement("card_b"), "x");
    await press(cardElement("card_b"), "Delete");
    await waitFor(
      () =>
        document.body.textContent?.includes("Delete 2 cards forever?") ?? false
    );
    const confirm = [
      ...document.querySelectorAll<HTMLButtonElement>(
        "[role='alertdialog'] button"
      ),
    ].find((button) => button.textContent?.trim() === "Delete forever");
    await act(async () => {
      confirm?.click();
      await Promise.resolve();
    });
    await waitFor(
      () => document.body.textContent?.includes("2 cards selected") ?? false
    );
  });

  test("a card in the open folder can be removed from it from its menu", async () => {
    const inFolder = { ...card("card_a", "First card"), folderIds: ["f1"] };
    const elsewhere = card("card_b", "Second card");
    const { cardElement, handlers } = await renderGrid({
      filteredCards: [inFolder, elsewhere],
      folder: { id: "f1", name: "Reading" },
    });
    const menuItems = async (id: string) => {
      await act(() => {
        cardElement(id).dispatchEvent(
          new MouseEvent("contextmenu", { bubbles: true, cancelable: true })
        );
      });
      return [...document.querySelectorAll<HTMLElement>("[role='menuitem']")];
    };
    const remove = (await menuItems("card_a")).find(
      (item) => item.textContent === "Remove from this folder"
    );
    expect(remove).toBeDefined();
    await act(() => remove?.click());
    expect(handlers.onBulkAction).toHaveBeenCalledWith(
      "removeFromFolder",
      ["card_a"],
      {
        folder: { folderId: "f1", folderName: "Reading" },
        priorFolderIds: new Map([["card_a", ["f1"]]]),
      }
    );
    await press(document.body, "Escape");
    expect(
      (await menuItems("card_b")).some(
        (item) => item.textContent === "Remove from this folder"
      )
    ).toBe(false);
  });

  const pressSelectAll = async (target: EventTarget) => {
    await act(() => {
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: "a",
        })
      );
    });
  };

  test("in selection mode, Ctrl+A selects every card shown, not the page's text", async () => {
    const three = [...CARDS, card("card_c", "Third card")];
    const { cardElement } = await renderGrid({ filteredCards: three });
    await pressSelectAll(document.body);
    expect(cardElement("card_b").getAttribute("aria-pressed")).toBeNull();

    await press(cardElement("card_a"), "x");
    await pressSelectAll(cardElement("card_a"));
    for (const id of ["card_a", "card_b", "card_c"]) {
      expect(cardElement(id).getAttribute("aria-pressed")).toBe("true");
    }
    expect(document.body.textContent).toContain("3 cards selected");
  });

  test("a card selected with the keyboard keeps the selected ring while focused", async () => {
    const { cardElement } = await renderGrid({});
    await press(cardElement("card_a"), "x");
    const shell = cardElement("card_a").closest("[data-card-shell]");
    expect(shell?.hasAttribute("data-selected")).toBe(true);
    // The ring sits on the tile, and selection's color wins over focus's.
    const tile = cardElement("card_a").querySelector(
      "[class*='group-data-[selected]/card:ring-primary!']"
    );
    expect(tile).not.toBeNull();
    expect(cardElement("card_a").className).not.toContain("ring-");
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

  test.each([
    ["the next card", "card_b", "card_c"],
    ["the card before when it was last", "card_c", "card_b"],
  ])(
    "a card deleted from its dialog hands focus to %s",
    async (_label, deleted, focused) => {
      const ref = createRef<MasonryGridHandle>();
      const three = [...CARDS, card("card_c", "Third card")];
      const { cardElement, handlers } = await renderGrid({
        filteredCards: three,
        ref,
      });
      await press(cardElement(deleted), "Enter");
      await act(() =>
        root?.render(
          <MasonryGrid
            filteredCards={three.filter((entry) => entry._id !== deleted)}
            ref={ref}
            {...handlers}
          />
        )
      );

      let returned = false;
      await act(() => {
        returned = ref.current?.returnFocusTo(deleted) ?? false;
      });
      expect(returned).toBe(true);
      expect(document.activeElement).toBe(cardElement(focused));
    }
  );

  test("leaves focus to a dialog the grid did not open", async () => {
    const ref = createRef<MasonryGridHandle>();
    await renderGrid({ ref });
    expect(ref.current?.returnFocusTo("card_a")).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });
});
