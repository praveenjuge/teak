import { describe, expect, test } from "bun:test";
import { history, undo } from "@codemirror/commands";
import { insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import { EditorState, Text, Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  activeMarkdownConstructs,
  applyInlineFormat,
  buildMarkdownDecorations,
  copyLinkUrl,
  editLinkDestination,
  isSafeExternalUrl,
  parseMarkdownLink,
  toggleTaskMarker,
} from "../liveMarkdown";
import {
  indentMarkdownListItem,
  outdentMarkdownListItem,
  teakMarkdownSupport,
} from "../markdownSupport";
import { parseMarkdownTable } from "../markdownTable";

function createTestView(
  source: string,
  selection: { anchor: number; head?: number },
  extensions: Parameters<typeof EditorState.create>[0]["extensions"] = []
) {
  let state = EditorState.create({
    doc: source,
    extensions: [
      EditorState.lineSeparator.of("\n"),
      teakMarkdownSupport(),
      extensions,
    ],
    selection,
  });
  const view = {
    focus() {
      // This test double only verifies document transactions.
    },
    get state() {
      return state;
    },
    dispatch(spec: Parameters<EditorState["update"]>[0] | Transaction) {
      state =
        spec instanceof Transaction ? spec.state : state.update(spec).state;
    },
  } as unknown as EditorView;
  return {
    get state() {
      return state;
    },
    view,
  };
}

function decorationSpecs(
  source: string,
  {
    hasFocus = false,
    readOnly = false,
    selection = source.length,
  }: { hasFocus?: boolean; readOnly?: boolean; selection?: number } = {}
) {
  const state = EditorState.create({
    doc: source,
    extensions: [teakMarkdownSupport(), EditorState.readOnly.of(readOnly)],
    selection: { anchor: selection },
  });
  const view = {
    hasFocus,
    state,
    visibleRanges: [{ from: 0, to: state.doc.length }],
  } as unknown as EditorView;
  const specs: Array<{ from: number; spec: unknown; to: number }> = [];
  buildMarkdownDecorations(view).between(
    0,
    state.doc.length,
    (from, to, decoration) => {
      specs.push({ from, spec: decoration.spec, to });
    }
  );
  return specs;
}

function runCommand(
  source: string,
  command: Parameters<typeof executeCommand>[1],
  anchor: number | undefined,
  lineSeparator = "\n"
) {
  const selectionAnchor =
    anchor ?? source.split(lineSeparator).join("\n").length;
  let state = EditorState.create({
    doc: Text.of(source.split(lineSeparator)),
    extensions: [
      EditorState.lineSeparator.of(lineSeparator),
      teakMarkdownSupport(),
    ],
    selection: { anchor: selectionAnchor },
  });
  const handled = executeCommand(
    {
      get state() {
        return state;
      },
      dispatch(transaction) {
        state = transaction.state;
      },
    },
    command
  );
  return { handled, state };
}

function executeCommand(
  target: {
    readonly state: EditorState;
    dispatch: (transaction: Transaction) => void;
  },
  command: (target: {
    state: EditorState;
    dispatch: (transaction: Transaction) => void;
  }) => boolean
) {
  return command(target);
}

describe("live Markdown editor", () => {
  test("identifies the complete construct around the caret", () => {
    const state = EditorState.create({
      doc: "# Heading\n\n**Bold** and plain",
      extensions: teakMarkdownSupport(),
      selection: { anchor: 15 },
    });

    expect(activeMarkdownConstructs(state)).toContainEqual({
      from: 11,
      to: 19,
    });
    expect(activeMarkdownConstructs(state)).not.toContainEqual({
      from: 0,
      to: 9,
    });
  });

  test("wraps and unwraps selected text without changing the text", () => {
    const testView = createTestView("Keep this exact", {
      anchor: 5,
      head: 9,
    });

    expect(applyInlineFormat(testView.view, "bold")).toBe(true);
    expect(testView.state.doc.toString()).toBe("Keep **this** exact");
    expect(applyInlineFormat(testView.view, "bold")).toBe(true);
    expect(testView.state.doc.toString()).toBe("Keep this exact");
  });

  test("wraps and unwraps strikethrough while preserving selection text", () => {
    const testView = createTestView("Keep this exact", {
      anchor: 5,
      head: 9,
    });

    expect(applyInlineFormat(testView.view, "strikethrough")).toBe(true);
    expect(testView.state.doc.toString()).toBe("Keep ~~this~~ exact");
    expect(
      testView.state.sliceDoc(
        testView.state.selection.main.from,
        testView.state.selection.main.to
      )
    ).toBe("this");
    expect(applyInlineFormat(testView.view, "strikethrough")).toBe(true);
    expect(testView.state.doc.toString()).toBe("Keep this exact");
  });

  test("creates an editable Markdown link and selects its destination", () => {
    const testView = createTestView("Read Teak", { anchor: 5, head: 9 });

    applyInlineFormat(testView.view, "link");

    expect(testView.state.doc.toString()).toBe("Read [Teak](https://)");
    expect(
      testView.state.sliceDoc(
        testView.state.selection.main.from,
        testView.state.selection.main.to
      )
    ).toBe("https://");
  });

  test("chooses a safe inline-code delimiter", () => {
    const testView = createTestView("Use `code` here", {
      anchor: 4,
      head: 10,
    });

    applyInlineFormat(testView.view, "code");

    expect(testView.state.doc.toString()).toBe("Use `` `code` `` here");
  });

  test("accepts only browser-safe external links", () => {
    expect(isSafeExternalUrl("https://teakvault.com/docs")).toBe(true);
    expect(isSafeExternalUrl("http://localhost:3000")).toBe(true);
    expect(isSafeExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeExternalUrl("data:text/html,unsafe")).toBe(false);
    expect(isSafeExternalUrl("mailto:hello@example.com")).toBe(false);
    expect(isSafeExternalUrl("not a url")).toBe(false);
  });

  test("renders inactive tasks as checkboxes and completed text as struck", () => {
    const unchecked = decorationSpecs("- [ ] Keep raw");
    const checked = decorationSpecs("- [x] Finished");

    expect(unchecked).toEqual(
      expect.arrayContaining([
        {
          from: 2,
          spec: expect.objectContaining({
            widget: expect.objectContaining({
              checked: false,
              disabled: false,
            }),
          }),
          to: 5,
        },
      ])
    );
    expect(checked).toEqual(
      expect.arrayContaining([
        {
          from: 6,
          spec: { class: "cm-md-task-complete" },
          to: 14,
        },
        {
          from: 2,
          spec: expect.objectContaining({
            widget: expect.objectContaining({ checked: true }),
          }),
          to: 5,
        },
      ])
    );
  });

  test("reveals raw task syntax while its list item is active", () => {
    const specs = decorationSpecs("- [ ] Keep raw", {
      hasFocus: true,
      selection: 8,
    });

    expect(
      specs.some(
        ({ from, spec, to }) =>
          from === 2 &&
          to === 5 &&
          "widget" in (spec as Record<string, unknown>)
      )
    ).toBe(false);
    expect(specs).toContainEqual({
      from: 2,
      spec: { class: "cm-md-syntax" },
      to: 5,
    });
  });

  test("task toggles are exact, disabled-safe, and undoable", () => {
    const editable = createTestView("- [ ] Keep source", { anchor: 7 }, [
      history(),
    ]);

    expect(toggleTaskMarker(editable.view, 2)).toBe(true);
    expect(editable.state.doc.toString()).toBe("- [x] Keep source");
    expect(undo(editable.view)).toBe(true);
    expect(editable.state.doc.toString()).toBe("- [ ] Keep source");

    const disabled = createTestView("- [ ] Keep source", { anchor: 7 }, [
      EditorState.readOnly.of(true),
    ]);
    expect(toggleTaskMarker(disabled.view, 2)).toBe(false);
    expect(disabled.state.doc.toString()).toBe("- [ ] Keep source");
    expect(decorationSpecs("- [ ] Keep source", { readOnly: true })).toEqual(
      expect.arrayContaining([
        {
          from: 2,
          spec: expect.objectContaining({
            widget: expect.objectContaining({ disabled: true }),
          }),
          to: 5,
        },
      ])
    );
    expect(applyInlineFormat(disabled.view, "strikethrough")).toBe(false);
    expect(disabled.state.doc.toString()).toBe("- [ ] Keep source");
  });

  test("renders GFM strikethrough without rewriting source", () => {
    const source = "Keep ~~the exact words~~ here";
    expect(decorationSpecs(source)).toEqual(
      expect.arrayContaining([
        {
          from: 7,
          spec: { class: "cm-md-strikethrough" },
          to: 22,
        },
        { from: 5, spec: {}, to: 7 },
        { from: 22, spec: {}, to: 24 },
      ])
    );
    expect(
      EditorState.create({
        doc: source,
        extensions: [teakMarkdownSupport()],
      }).doc.toString()
    ).toBe(source);
  });

  test("renders safe plain URLs as actions but leaves email and unsafe schemes inert", () => {
    const safe = "Visit https://example.com/path?q=1";
    const safeSpecs = decorationSpecs(safe);
    expect(safeSpecs).toEqual(
      expect.arrayContaining([
        {
          from: 6,
          spec: expect.objectContaining({
            widget: expect.objectContaining({
              href: "https://example.com/path?q=1",
              label: "https://example.com/path?q=1",
            }),
          }),
          to: safe.length,
        },
      ])
    );
    expect(
      decorationSpecs("Email hello@example.com").some(
        ({ spec }) => "widget" in (spec as Record<string, unknown>)
      )
    ).toBe(false);
    expect(
      decorationSpecs("[Bad](javascript:alert(1))").some(
        ({ spec }) => "widget" in (spec as Record<string, unknown>)
      )
    ).toBe(false);
    expect(decorationSpecs("[Bad](javascript:alert(1))")).toContainEqual({
      from: 0,
      spec: { class: "cm-md-link-unsafe" },
      to: 26,
    });
    expect(
      decorationSpecs("- [ ] Review https://example.com/task").some(
        ({ spec }) =>
          "widget" in (spec as Record<string, unknown>) &&
          (spec as { widget?: { href?: string } }).widget?.href ===
            "https://example.com/task"
      )
    ).toBe(true);
  });

  test("link actions select only the destination and report copy failures", async () => {
    const source = "Read [Teak](https://teakvault.com/docs) now";
    const parsed = parseMarkdownLink("[Teak](https://teakvault.com/docs)", 5);
    expect(parsed).not.toBeNull();
    const testView = createTestView(source, { anchor: 0 });
    editLinkDestination(testView.view, parsed!);
    expect(
      testView.state.sliceDoc(
        testView.state.selection.main.from,
        testView.state.selection.main.to
      )
    ).toBe("https://teakvault.com/docs");
    expect(testView.state.doc.toString()).toBe(source);

    let copied = "";
    expect(
      await copyLinkUrl("https://example.com", (value) => {
        copied = value;
        return Promise.resolve();
      })
    ).toBe(true);
    expect(copied).toBe("https://example.com");
    expect(
      await copyLinkUrl("https://example.com", () =>
        Promise.reject(new Error("Clipboard unavailable"))
      )
    ).toBe(false);
  });

  test("continues bullets, ordered lists, tasks, and blockquotes on Enter", () => {
    expect(
      runCommand("- item", insertNewlineContinueMarkup).state.doc.toString()
    ).toBe("- item\n- ");
    expect(
      runCommand("1. item", insertNewlineContinueMarkup).state.doc.toString()
    ).toBe("1. item\n2. ");
    expect(
      runCommand("- [x] done", insertNewlineContinueMarkup).state.doc.toString()
    ).toBe("- [x] done\n- [ ] ");
    expect(
      runCommand("> quote", insertNewlineContinueMarkup).state.doc.toString()
    ).toBe("> quote\n> ");
  });

  test("exits empty list and task items without leaving marker syntax", () => {
    expect(
      runCommand("- ", insertNewlineContinueMarkup).state.doc.toString()
    ).toBe("");
    expect(
      runCommand("- [ ] ", insertNewlineContinueMarkup).state.doc.toString()
    ).toBe("");
    expect(
      runCommand("1. ", insertNewlineContinueMarkup).state.doc.toString()
    ).toBe("");
    expect(
      runCommand(">\n> ", insertNewlineContinueMarkup).state.doc.toString()
    ).toBe("\n");
  });

  test("indents and outdents list items only, including nested items", () => {
    const indented = runCommand("- parent\n- child", indentMarkdownListItem);
    expect(indented.handled).toBe(true);
    expect(indented.state.doc.toString()).toBe("- parent\n  - child");

    const outdented = runCommand(
      "- parent\n  - child",
      outdentMarkdownListItem
    );
    expect(outdented.handled).toBe(true);
    expect(outdented.state.doc.toString()).toBe("- parent\n- child");

    expect(
      runCommand("1. one\n2. two", indentMarkdownListItem).state.doc.toString()
    ).toBe("1. one\n  2. two");
    expect(
      runCommand(
        "- [ ] one\n- [ ] two",
        indentMarkdownListItem
      ).state.doc.toString()
    ).toBe("- [ ] one\n  - [ ] two");
    expect(
      runCommand(
        "- parent\n  1. one\n  2. two",
        indentMarkdownListItem
      ).state.doc.toString()
    ).toBe("- parent\n  1. one\n    2. two");
    expect(
      runCommand(
        "- parent\n    - child",
        outdentMarkdownListItem
      ).state.doc.toString()
    ).toBe("- parent\n  - child");
    expect(runCommand("plain", indentMarkdownListItem).handled).toBe(false);
    expect(runCommand("> quote", indentMarkdownListItem).handled).toBe(false);
  });

  test("preserves CRLF line endings through list continuation and indentation", () => {
    const continued = runCommand(
      "- first\r\n- second",
      insertNewlineContinueMarkup,
      undefined,
      "\r\n"
    );
    expect(continued.state.sliceDoc(0)).toBe("- first\r\n- second\r\n- ");

    const indented = runCommand(
      "- first\r\n- second",
      indentMarkdownListItem,
      undefined,
      "\r\n"
    );
    expect(indented.state.sliceDoc(0)).toBe("- first\r\n  - second");
  });

  test("removes heading syntax whitespace from the inactive rendering", () => {
    expect(decorationSpecs("#  Heading")).toContainEqual({
      from: 0,
      spec: {},
      to: 3,
    });
  });

  test("keeps Markdown comments visible with subdued styling", () => {
    expect(decorationSpecs("<!-- quiet context -->")).toContainEqual({
      from: 0,
      spec: { class: "cm-md-comment" },
      to: 22,
    });
  });

  test("collapses the closing fence after the final code line", () => {
    const source = "```sh\nnpm install\n```";

    expect(decorationSpecs(source)).toEqual(
      expect.arrayContaining([
        {
          from: 0,
          spec: { class: "cm-md-code-line cm-md-code-first" },
          to: 0,
        },
        {
          from: 6,
          spec: { class: "cm-md-code-line cm-md-code-last" },
          to: 6,
        },
        {
          from: 18,
          spec: { class: "cm-md-code-fence-hidden" },
          to: 18,
        },
      ])
    );
  });

  test("parses simple tables with alignment and escaped pipes", () => {
    expect(
      parseMarkdownTable(
        "| Package | Target | Notes |\n| :--- | :---: | ---: |\n| `teak` | Web | A \\| B |"
      )
    ).toEqual({
      alignments: ["left", "center", "right"],
      headers: ["Package", "Target", "Notes"],
      rows: [["`teak`", "Web", "A | B"]],
    });
  });

  test("renders an inactive table as one block widget", () => {
    const source = "| Name | Use |\n| --- | --- |\n| Teak | Notes |";
    expect(decorationSpecs(source)).toEqual(
      expect.arrayContaining([
        {
          from: 0,
          spec: expect.objectContaining({ block: true }),
          to: 0,
        },
        { from: 0, spec: {}, to: source.length },
      ])
    );
  });

  test("round-trips LF, CRLF, mixed whitespace, and trailing spaces", () => {
    const sources = [
      "# LF\n\nText  \n",
      "# CRLF\r\n\r\nText  \r\n",
      "# Mixed\r\n\n\tText  \n",
    ];

    for (const source of sources) {
      const state = EditorState.create({
        doc: source,
        extensions: EditorState.lineSeparator.of("\n"),
      });
      expect(state.doc.toString()).toBe(source);
    }
  });
});
