import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Doc } from "@teak/convex/_generated/dataModel";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost:3000" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

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

test("on a phone the note is only as tall as its text; on a wide screen it fills the stage", async () => {
  const { cardDialog } = await renderCardWithDialogOver();
  const wrapper = cardDialog.querySelector<HTMLElement>(
    ".group\\/text-preview"
  );
  expect(wrapper?.className).toContain("max-md:[--teak-note-min-height:6rem]");
  const fieldset = cardDialog.querySelector<HTMLElement>("fieldset");
  expect(fieldset?.style.getPropertyValue("--teak-editor-min-height")).toBe(
    "var(--teak-note-min-height, 55vh)"
  );
});
