import { afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";
import { englishTranslator } from "@/lib/englishTranslators";

GlobalRegistrator.register({ url: "http://localhost:3000" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const realConvexReact = await import("convex/react");
mock.module("convex/react", () => ({
  ...realConvexReact,
  useAction: () => mock(),
  useMutation: () => mock(),
}));

// What a copy put on the clipboard, in order.
const clipboard: string[] = [];
Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: {
    writeText: (text: string) => {
      clipboard.push(text);
      return Promise.resolve();
    },
  },
});
const copied = async () => {
  await act(() => Promise.resolve());
  return clipboard;
};

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { Card, getCardAccessibleLabel } = await import("../Card");

const accessibleLabel = (card: Parameters<typeof getCardAccessibleLabel>[0]) =>
  getCardAccessibleLabel(
    card,
    englishTranslator("cards.accessibleLabel"),
    englishTranslator("lib.linkTitle")
  );

let root: Root | undefined;

afterEach(async () => {
  clipboard.length = 0;
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

  // ⌘ on a Mac, Ctrl elsewhere: the key the menu and the shortcuts list name.
  const apple = /Mac|iPhone|iPad/.test(navigator.platform);
  const MOD = apple ? "metaKey" : "ctrlKey";
  const OTHER = apple ? "ctrlKey" : "metaKey";

  test("copies the card's text with the platform's ⌘C or Ctrl+C", async () => {
    const card = await renderCard({});
    await pressCopy(card, MOD);
    expect(await copied()).toEqual(["my\\_file\\_name\\_v2 costs 2\\*3"]);
  });

  test("the other platform's key doesn't copy", async () => {
    const card = await renderCard({});
    await pressCopy(card, OTHER);
    expect(await copied()).toEqual([]);
  });

  test("copies a card link in the note as its title", async () => {
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
        />
      )
    );
    const card = container.querySelector<HTMLElement>('[role="button"]');
    await pressCopy(card as HTMLElement, MOD);
    expect(await copied()).toEqual(["See Garden plan first"]);
  });

  test("leaves Cmd+C to the browser while text is selected", async () => {
    const card = await renderCard({});
    const paragraph = document.createElement("p");
    paragraph.textContent = "Selected words";
    document.body.append(paragraph);
    window.getSelection()?.selectAllChildren(paragraph);
    await pressCopy(card, MOD);
    window.getSelection()?.removeAllRanges();
    expect(await copied()).toEqual([]);
  });

  test("does not copy a card in Trash", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(() =>
      root?.render(<Card card={textCard({ isDeleted: true })} />)
    );
    const card = container.querySelector<HTMLElement>('[role="button"]');
    expect(card).not.toBeNull();
    await pressCopy(card as HTMLElement, MOD);
    expect(await copied()).toEqual([]);
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

  test.each([
    ["f", "favorite"],
    ["p", "pin"],
    ["t", "addTags"],
    ["e", "archive"],
    ["x", "select"],
    ["Delete", "moveToTrash"],
    ["Backspace", "moveToTrash"],
  ] as const)(
    "pressing %p in the right-click menu runs %s and closes it",
    async (key, action) => {
      const onAction = mock();
      const card = await renderCard({ onAction });
      const menu = await openContextMenu(card);
      await pressInMenu(menu, { key });
      expect(onAction).toHaveBeenCalledTimes(1);
      expect(onAction.mock.calls[0]?.[0]).toBe(action);
      expect(onAction.mock.calls[0]?.[1]?._id).toBe("card_123");
      expect(document.querySelector('[role="menu"]')).toBeNull();
    }
  );

  test("copies with Ctrl+C while the right-click menu is open", async () => {
    const card = await renderCard({});
    const menu = await openContextMenu(card);
    const apple = /Mac|iPhone|iPad/.test(navigator.platform);
    await pressInMenu(menu, {
      key: "c",
      [apple ? "metaKey" : "ctrlKey"]: true,
    });
    await act(() => Promise.resolve());
    expect(await copied()).toEqual(["my\\_file\\_name\\_v2 costs 2\\*3"]);
  });

  test("leaves keys with no shortcut to the menu", async () => {
    const onAction = mock();
    const card = await renderCard({ onAction });
    const menu = await openContextMenu(card);
    await pressInMenu(menu, { key: "f", metaKey: true });
    await pressInMenu(menu, { key: "z" });
    expect(onAction).not.toHaveBeenCalled();
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
  });
});

describe("getCardAccessibleLabel", () => {
  test.each([
    [
      {
        type: "link",
        content: "",
        metadata: { linkPreview: { status: "success", title: "Example" } },
        url: "https://example.com",
      },
      "Link: Example",
    ],
    [
      { type: "link", content: "", url: "https://example.com" },
      "Link: https://example.com",
    ],
    [
      { type: "image", content: "", fileMetadata: { fileName: "cat.png" } },
      "Image: cat.png",
    ],
    [{ type: "quote", content: "**Stay** curious" }, "Quote: Stay curious"],
    [{ type: "text", content: "Groceries\n- eggs" }, "Text: Groceries"],
    [{ type: "audio", content: "" }, "Audio card"],
  ] as const)("names %p", (card, expected) => {
    expect(accessibleLabel(card as any)).toBe(expected);
  });

  test("clips very long text", () => {
    const label = accessibleLabel({
      type: "text",
      content: "a".repeat(500),
    } as any);
    expect(label.length).toBeLessThanOrEqual("Text: ".length + 120);
    expect(label.endsWith("…")).toBe(true);
  });
});
