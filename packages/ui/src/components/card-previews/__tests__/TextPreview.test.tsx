import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Doc } from "@teak/convex/_generated/dataModel";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost:3000" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

// Keep the editor's plain stand-in on screen: the rich editor's code never
// finishes loading here. The package's test script runs each file alone.
mock.module("../../text-editor/LoadedMarkdownTextEditor", () => ({
  default: () => {
    throw new Promise(() => undefined);
  },
}));
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { isApplePlatform } = await import("../../../lib/platform");
const { TextPreview } = await import("../TextPreview");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

const card = {
  _id: "card",
  content: "A note to focus on",
  type: "text",
} as unknown as Doc<"cards">;

/** The card's dialog with the note in it, and a second dialog over it. */
async function renderCardWithDialogOver() {
  const cardDialog = document.createElement("div");
  cardDialog.setAttribute("role", "dialog");
  const over = document.createElement("div");
  over.setAttribute("role", "dialog");
  const overInput = document.createElement("input");
  over.append(overInput);
  document.body.append(cardDialog, over);
  root = createRoot(cardDialog);
  await act(() =>
    root?.render(<TextPreview card={card} onContentChange={() => undefined} />)
  );
  return { cardDialog, overInput };
}

const pressFocusKey = (target: Element) =>
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "e",
        ...(isApplePlatform() ? { metaKey: true } : { ctrlKey: true }),
      })
    );
  });

// Focus's code loads on demand, so give it time to appear.
async function focusIsOpen() {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (document.querySelector("[data-focus-editor]")) {
      return true;
    }
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
  }
  return false;
}

test("Cmd/Ctrl+E in a dialog over the card leaves Focus closed", async () => {
  const { overInput } = await renderCardWithDialogOver();
  await pressFocusKey(overInput);
  expect(await focusIsOpen()).toBe(false);
});

test("Cmd/Ctrl+E anywhere in the card opens Focus", async () => {
  const { cardDialog } = await renderCardWithDialogOver();
  const focusButton = cardDialog.querySelector("button[aria-label='Focus']");
  await pressFocusKey(focusButton as Element);
  expect(await focusIsOpen()).toBe(true);
});
