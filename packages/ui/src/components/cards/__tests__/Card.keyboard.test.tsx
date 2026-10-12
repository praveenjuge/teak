import { afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost:3000" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

// Convex is the external boundary: the card only needs `useAction` for
// copying images, which these tests never trigger.
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
