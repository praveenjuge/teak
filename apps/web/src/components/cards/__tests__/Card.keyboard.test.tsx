import { afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost:3000" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const realConvexReact = await import("convex/react");
mock.module("convex/react", () => ({
  ...realConvexReact,
  useAction: () => mock(),
  useMutation: () => mock(),
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { Card, getCardAccessibleLabel } = await import("../Card");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

const textCard = (overrides: Record<string, unknown> = {}) =>
  ({
    _creationTime: 1,
    _id: "card_123",
    content: "my\\_file\\_name\\_v2 costs 2\\*3",
    createdAt: 1,
    type: "text",
    updatedAt: 1,
    userId: "user_123",
    ...overrides,
  }) as any;

async function renderCard(props: Record<string, unknown>) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => root?.render(<Card card={textCard()} {...props} />));
  const element = container.querySelector<HTMLElement>('[role="button"]');
  expect(element).not.toBeNull();
  return element as HTMLElement;
}

const press = async (element: HTMLElement, key: string) => {
  await act(() => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key })
    );
  });
};

describe("Card keyboard access", () => {
  test("is a focusable button named after its content", async () => {
    const card = await renderCard({ onClick: () => undefined });
    expect(card.tabIndex).toBe(0);
    expect(card.getAttribute("aria-label")).toBe(
      "Text: my_file_name_v2 costs 2*3"
    );
    card.focus();
    expect(document.activeElement).toBe(card);
  });

  // Bug 01: the editor saves `<`, `>` and `&` as entities.
  test("is named after its text as typed, not its entities", async () => {
    const card = await renderCard({
      card: textCard({ content: "3 &lt; 5 &amp; &gt; quote" }),
    });
    expect(card.getAttribute("aria-label")).toBe("Text: 3 < 5 & > quote");
  });

  test.each(["Enter", " "])("opens with the %p key", async (key) => {
    const onClick = mock();
    const card = await renderCard({ onClick });
    await press(card, key);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick.mock.calls[0]?.[0]?._id).toBe("card_123");
  });

  test("ignores other keys", async () => {
    const onClick = mock();
    const card = await renderCard({ onClick });
    await press(card, "a");
    expect(onClick).not.toHaveBeenCalled();
  });

  const pressCopy = async (element: HTMLElement, modifier: string) => {
    await act(() => {
      element.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "c",
          [modifier]: true,
        })
      );
    });
  };

  test.each(["metaKey", "ctrlKey"])(
    "copies the card's text with %s+C",
    async (modifier) => {
      const onCopyImage = mock();
      const card = await renderCard({ onCopyImage });
      await pressCopy(card, modifier);
      expect(onCopyImage).toHaveBeenCalledWith(
        "my\\_file\\_name\\_v2 costs 2\\*3",
        false
      );
    }
  );

  // Bug 19: Copy text copied the raw `[[Title|teak:<id>]]` token.
  test("copies a card link in the note as its title", async () => {
    const onCopyImage = mock();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(() =>
      root?.render(
        <Card
          card={textCard({
            content:
              "See [[Garden plan|teak:k17a8m9x2p3q4r5s6t7u8v9w0y1z2a3b]] first",
          })}
          onCopyImage={onCopyImage}
        />
      )
    );
    const card = container.querySelector<HTMLElement>('[role="button"]');
    await pressCopy(card as HTMLElement, "metaKey");
    expect(onCopyImage).toHaveBeenCalledWith("See Garden plan first", false);
  });

  test("leaves Cmd+C to the browser while text is selected", async () => {
    const onCopyImage = mock();
    const card = await renderCard({ onCopyImage });
    const paragraph = document.createElement("p");
    paragraph.textContent = "Selected words";
    document.body.append(paragraph);
    window.getSelection()?.selectAllChildren(paragraph);
    await pressCopy(card, "metaKey");
    window.getSelection()?.removeAllRanges();
    expect(onCopyImage).not.toHaveBeenCalled();
  });

  test("does not copy a card in Trash", async () => {
    const onCopyImage = mock();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(() =>
      root?.render(
        <Card card={textCard({ isDeleted: true })} onCopyImage={onCopyImage} />
      )
    );
    const card = container.querySelector<HTMLElement>('[role="button"]');
    expect(card).not.toBeNull();
    await pressCopy(card as HTMLElement, "metaKey");
    expect(onCopyImage).not.toHaveBeenCalled();
  });

  test("exposes the selected state in selection mode", async () => {
    const onClick = mock();
    const card = await renderCard({
      isSelected: true,
      isSelectionMode: true,
      onClick,
    });
    expect(card.getAttribute("aria-pressed")).toBe("true");
    await press(card, " ");
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("keeps a card that is still saving out of the tab order", async () => {
    const onClick = mock();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(() =>
      root?.render(
        <Card
          card={textCard({ _id: "0b6f9a8e-1c2d-4e3f-8a9b-0c1d2e3f4a5b" })}
          onClick={onClick}
        />
      )
    );
    const card = container.querySelector<HTMLElement>('[role="button"]');
    expect(card?.tabIndex).toBe(-1);
    if (card) {
      await press(card, "Enter");
    }
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("Card menu shortcuts", () => {
  const openContextMenu = async (card: HTMLElement) => {
    await act(() => {
      card.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 10,
          clientY: 10,
        })
      );
    });
    const menu = document.querySelector<HTMLElement>('[role="menu"]');
    expect(menu).not.toBeNull();
    return menu as HTMLElement;
  };

  const pressInMenu = async (
    menu: HTMLElement,
    init: KeyboardEventInit & { key: string }
  ) => {
    const target =
      document.activeElement instanceof HTMLElement &&
      menu.contains(document.activeElement)
        ? document.activeElement
        : menu;
    await act(() => {
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ...init,
        })
      );
    });
  };

  // Bug: a right-click menu listed F, T, E, X and Delete, but pressing them
  // while it was open did nothing.
  test.each([
    ["f", "onToggleFavorite", ["card_123"]],
    ["t", "onAddTags", ["card_123"]],
    ["e", "onToggleArchive", ["card_123", true]],
    ["x", "onEnterSelectionMode", ["card_123"]],
    ["Delete", "onDelete", ["card_123"]],
    ["Backspace", "onDelete", ["card_123"]],
  ] as const)(
    "pressing %p in the right-click menu runs %s and closes it",
    async (key, handler, args) => {
      const spy = mock();
      const card = await renderCard({ [handler]: spy });
      const menu = await openContextMenu(card);
      await pressInMenu(menu, { key });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]).toEqual([...args]);
      expect(document.querySelector('[role="menu"]')).toBeNull();
    }
  );

  test("copies with Ctrl+C while the right-click menu is open", async () => {
    const onCopyImage = mock();
    const card = await renderCard({ onCopyImage });
    const menu = await openContextMenu(card);
    const apple = /Mac|iPhone|iPad/.test(navigator.platform);
    await pressInMenu(menu, {
      key: "c",
      [apple ? "metaKey" : "ctrlKey"]: true,
    });
    await act(() => Promise.resolve());
    expect(onCopyImage).toHaveBeenCalledWith(
      "my\\_file\\_name\\_v2 costs 2\\*3",
      false
    );
  });

  test("leaves keys with no shortcut to the menu", async () => {
    const onToggleFavorite = mock();
    const card = await renderCard({ onToggleFavorite });
    const menu = await openContextMenu(card);
    await pressInMenu(menu, { key: "f", metaKey: true });
    await pressInMenu(menu, { key: "z" });
    expect(onToggleFavorite).not.toHaveBeenCalled();
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
  });
});

describe("getCardAccessibleLabel", () => {
  test.each([
    [
      { type: "link", content: "", url: "https://example.com" },
      "Example",
      "Link: Example",
    ],
    [
      { type: "link", content: "", url: "https://example.com" },
      undefined,
      "Link: https://example.com",
    ],
    [
      { type: "image", content: "", fileMetadata: { fileName: "cat.png" } },
      undefined,
      "Image: cat.png",
    ],
    [
      { type: "quote", content: "**Stay** curious" },
      undefined,
      "Quote: Stay curious",
    ],
    [{ type: "audio", content: "" }, undefined, "Audio card"],
  ] as const)("names %p", (card, linkTitle, expected) => {
    expect(getCardAccessibleLabel(card as any, linkTitle)).toBe(expected);
  });

  test("clips very long text", () => {
    const label = getCardAccessibleLabel({
      type: "text",
      content: "a".repeat(500),
    } as any);
    expect(label.length).toBeLessThanOrEqual("Text: ".length + 120);
    expect(label.endsWith("…")).toBe(true);
  });
});
