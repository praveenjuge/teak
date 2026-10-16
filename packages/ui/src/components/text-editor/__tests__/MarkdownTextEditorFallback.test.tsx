import { afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost:3000" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MarkdownTextEditor } = await import("../MarkdownTextEditor");
const { focusNewNoteComposer } = await import("../../../lib/keyboardShortcuts");

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

function renderEditor(
  props: Partial<Parameters<typeof MarkdownTextEditor>[0]> = {}
) {
  const onChange = mock((_content: string) => undefined);
  const container = document.createElement("div");
  container.setAttribute("data-new-note-composer", "");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <MarkdownTextEditor
        ariaLabel="Markdown content"
        onChange={onChange}
        value="Draft"
        {...props}
      />
    )
  );
  const textarea = container.querySelector("textarea");
  if (!textarea) {
    throw new Error("No stand-in textarea");
  }
  return { onChange, textarea };
}

function type(textarea: HTMLTextAreaElement, text: string) {
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value"
  )?.set;
  act(() => {
    setValue?.call(textarea, text);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("the editor while it loads", () => {
  test("edits the same Markdown in a plain textarea", () => {
    const { onChange, textarea } = renderEditor();
    expect(textarea.value).toBe("Draft");
    expect(textarea.getAttribute("aria-label")).toBe("Markdown content");
    type(textarea, "Draft and more");
    expect(onChange).toHaveBeenCalledWith("Draft and more");
  });

  test("saves typed HTML as text, as the rich editor does", () => {
    const saved: string[] = [];
    function Composer() {
      const [note, setNote] = useState("");
      return (
        <MarkdownTextEditor
          onChange={(content) => {
            saved.push(content);
            setNote(content);
          }}
          value={note}
        />
      );
    }
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(<Composer />));
    const textarea = container.querySelector("textarea");
    if (!textarea) {
      throw new Error("No stand-in textarea");
    }
    const note = [
      'Hi <script>alert("x")</script> in `<b>`',
      "",
      "    <div>",
      "",
      "- <i>item</i>",
      "- ```",
      "  <pre>",
      "  ```",
    ].join("\n");
    type(textarea, note);
    expect(saved.at(-1)).toBe(
      [
        'Hi &lt;script&gt;alert("x")&lt;/script&gt; in `<b>`',
        "",
        "    <div>",
        "",
        "- &lt;i&gt;item&lt;/i&gt;",
        "- ```",
        "  <pre>",
        "  ```",
      ].join("\n")
    );
    expect(textarea.value).toBe(note);
  });

  test("leaves the HTML a note already holds as it is", () => {
    const { onChange, textarea } = renderEditor({ value: "<b>Draft</b>" });
    type(textarea, "<b>Draft</b> <i>more</i>");
    expect(onChange).toHaveBeenCalledWith("<b>Draft</b> <i>more</i>");
  });

  test("refuses a note over 512 KiB", () => {
    const onLimitExceeded = mock(() => undefined);
    const { onChange, textarea } = renderEditor({ onLimitExceeded });
    type(textarea, "x".repeat(512 * 1024 + 1));
    expect(onLimitExceeded).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  test("saves with Cmd/Ctrl+Enter and opens full screen with Cmd/Ctrl+E", () => {
    const onSaveShortcut = mock(() => undefined);
    const onOpenFullScreen = mock(() => undefined);
    const { textarea } = renderEditor({ onOpenFullScreen, onSaveShortcut });
    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          ctrlKey: true,
          key: "Enter",
        })
      );
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "e", metaKey: true })
      );
    });
    expect(onSaveShortcut).toHaveBeenCalledTimes(1);
    expect(onOpenFullScreen).toHaveBeenCalledTimes(1);
  });

  test("takes focus from N in the composer", () => {
    const { textarea } = renderEditor();
    expect(focusNewNoteComposer()).toBe(true);
    expect(document.activeElement).toBe(textarea);
  });
});
