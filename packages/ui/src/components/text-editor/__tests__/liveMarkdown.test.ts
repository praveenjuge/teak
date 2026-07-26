import { describe, expect, test } from "bun:test";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  activeMarkdownConstructs,
  applyInlineFormat,
  isSafeExternalUrl,
} from "../liveMarkdown";

function createTestView(
  source: string,
  selection: { anchor: number; head?: number }
) {
  let state = EditorState.create({
    doc: source,
    extensions: [EditorState.lineSeparator.of("\n"), markdown()],
    selection,
  });
  const view = {
    focus() {
      // This test double only verifies document transactions.
    },
    get state() {
      return state;
    },
    dispatch(spec: Parameters<EditorState["update"]>[0]) {
      state = state.update(spec).state;
    },
  } as unknown as EditorView;
  return {
    get state() {
      return state;
    },
    view,
  };
}

describe("live Markdown editor", () => {
  test("identifies the complete construct around the caret", () => {
    const state = EditorState.create({
      doc: "# Heading\n\n**Bold** and plain",
      extensions: markdown(),
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
    expect(isSafeExternalUrl("not a url")).toBe(false);
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
