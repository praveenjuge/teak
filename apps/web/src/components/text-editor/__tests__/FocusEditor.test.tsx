import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost:3000" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

mock.module("../LoadedMarkdownTextEditor", () => ({
  default: () => {
    throw new Promise(() => undefined);
  },
}));
const { act, useState } = await import("react");
const { isApplePlatform } = await import("../../../lib/platform");
const { createRoot } = await import("react-dom/client");
const { editorPopupOwnsEscape, FocusEditor, WORD_COUNT_IDLE_MS } = await import(
  "../FocusEditor"
);

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

async function renderFocus(
  props: Partial<Parameters<typeof FocusEditor>[0]> = {}
) {
  const handlers = {
    onChange: mock((_value: string) => undefined),
    onRequestClose: mock(() => undefined),
    onSave: mock(() => undefined),
  };
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() =>
    root?.render(
      <FocusEditor
        canSave
        open
        placeholder="Write a note…"
        title="Focus"
        value="Three small words"
        {...handlers}
        {...props}
      />
    )
  );
  return handlers;
}

const focusDialog = () =>
  document.querySelector<HTMLElement>("[data-focus-editor]");
const button = (name: string) =>
  [...document.querySelectorAll("button")].find((element) =>
    element.textContent?.trim().startsWith(name)
  );
const editor = () =>
  focusDialog()?.querySelector<HTMLTextAreaElement>("textarea") ?? null;
const press = (target: Element, init: KeyboardEventInit) =>
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })
    );
  });

test("opens full screen with its title, the note and the word count", async () => {
  await renderFocus({ title: "Writing the draft" });
  const dialog = focusDialog();
  const labelId = dialog?.getAttribute("aria-labelledby") ?? "";
  expect(document.getElementById(labelId)?.textContent).toBe(
    "Writing the draft"
  );
  expect(editor()?.value).toBe("Three small words");
  expect(focusDialog()?.querySelector("[data-word-count]")).not.toBeNull();
});

test("Save is disabled while there is nothing to save", async () => {
  const { onSave } = await renderFocus({ canSave: false, value: "" });
  const save = button("Save");
  expect(save?.disabled).toBe(true);
  await press(editor() as Element, { key: "Enter", ctrlKey: true });
  expect(onSave).not.toHaveBeenCalled();
});

test("Save, and Ctrl+Enter in the note, save", async () => {
  const { onSave } = await renderFocus();
  await act(() => button("Save")?.click());
  expect(onSave).toHaveBeenCalledTimes(1);
  await press(editor() as Element, { key: "Enter", ctrlKey: true });
  expect(onSave).toHaveBeenCalledTimes(2);
});

test("Ctrl+E in the note and Close both leave Focus", async () => {
  const { onRequestClose } = await renderFocus();
  await press(editor() as Element, { key: "e", ctrlKey: true });
  expect(onRequestClose).toHaveBeenCalledTimes(1);
  await act(() => button("Close")?.click());
  expect(onRequestClose).toHaveBeenCalledTimes(2);
});

test("Cmd/Ctrl+E leaves Focus from Close or Save too, not only the note", async () => {
  const { onRequestClose } = await renderFocus();
  const modifier = isApplePlatform() ? { metaKey: true } : { ctrlKey: true };
  const close = button("Close") as HTMLButtonElement;
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: "e",
    ...modifier,
  });
  await act(() => {
    close.dispatchEvent(event);
  });
  expect(onRequestClose).toHaveBeenCalledTimes(1);
  expect(event.defaultPrevented).toBe(true);
});

test("typing hides the bar and the count; a pause shows the new count", async () => {
  function Harness() {
    const [value, setValue] = useState("Three small words");
    return (
      <FocusEditor
        canSave
        onChange={setValue}
        onRequestClose={() => undefined}
        onSave={() => undefined}
        open
        placeholder="Write a note…"
        title="Focus"
        value={value}
      />
    );
  }
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => root?.render(<Harness />));
  const chrome = () =>
    focusDialog()
      ?.querySelector("[data-focus-chrome]")
      ?.getAttribute("data-focus-chrome");
  const count = () => focusDialog()?.querySelector("[data-word-count]");

  const textarea = editor() as HTMLTextAreaElement;
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    )?.set?.call(textarea, "Three small words and two");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(chrome()).toBe("hidden");
  expect(count()?.getAttribute("data-word-count")).toBe("hidden");

  await act(
    () =>
      new Promise((resolve) => setTimeout(resolve, WORD_COUNT_IDLE_MS + 100))
  );
  expect(count()?.getAttribute("data-word-count")).toBe("shown");
  expect(count()?.textContent).toBe("5 words");

  await act(() => {
    focusDialog()?.dispatchEvent(new Event("pointermove", { bubbles: true }));
  });
  expect(chrome()).toBe("visible");
});

test.each([
  [
    "the slash menu is open",
    "<div role='listbox' aria-label='Formatting commands' data-editor-popup></div><p data-active></p>",
    true,
  ],
  [
    "the card link menu is open",
    "<div role='listbox' aria-label='Link a card' data-editor-popup></div><p data-active></p>",
    true,
  ],
  [
    "the link editor has focus",
    "<div class='teak-editor-formatting'><input data-active /></div>",
    true,
  ],
  [
    "only the note has focus",
    "<div contenteditable='true'><p data-active></p></div>",
    false,
  ],
  [
    "another listbox is open",
    "<div role='listbox' aria-label='Search'></div><p data-active></p>",
    false,
  ],
] as const)(
  "Esc stays with the editor when %s: %p",
  (_name, html, expected) => {
    const dialog = document.createElement("div");
    dialog.append(
      ...new DOMParser().parseFromString(html, "text/html").body.childNodes
    );
    document.body.append(dialog);
    expect(
      editorPopupOwnsEscape(dialog, dialog.querySelector("[data-active]"))
    ).toBe(expected);
  }
);
