import { describe, expect, test } from "bun:test";
import { getSchema } from "@tiptap/core";
import { history, undo } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import {
  documentExtensions,
  markdownManager,
  prepareMarkdownDocument,
} from "../markdownDocument";
import {
  moveToggledTaskItem,
  sortedTaskOrder,
  taskListSortPlugin,
} from "../taskListSort";

const schema = getSchema(documentExtensions());

function stateFor(markdown: string) {
  const prepared = prepareMarkdownDocument(markdown);
  return EditorState.create({
    doc: schema.nodeFromJSON(prepared.document),
    plugins: [history(), taskListSortPlugin()],
  });
}

/** Where the task item with this text sits, as the checkbox would see it. */
function taskItemPos(doc: ProseMirrorNode, text: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (
      found === -1 &&
      node.type.name === "taskItem" &&
      node.firstChild?.textContent === text
    ) {
      found = pos;
    }
  });
  if (found === -1) {
    throw new Error(`No task item "${text}"`);
  }
  return found;
}

/** The checkbox's own change: `setNodeMarkup` with `checked` flipped. */
function toggle(state: EditorState, text: string) {
  const pos = taskItemPos(state.doc, text);
  const node = state.doc.nodeAt(pos);
  return state.tr.setNodeMarkup(pos, undefined, {
    ...node?.attrs,
    checked: !node?.attrs.checked,
  });
}

const markdownOf = (state: EditorState) =>
  markdownManager.serialize(state.doc.toJSON());

describe("ticking and unticking reorders the list", () => {
  test.each([
    [
      "ticking the first of three moves it to the end",
      "- [ ] A\n- [ ] B\n- [ ] C",
      "A",
      "- [ ] B\n- [ ] C\n- [x] A",
    ],
    [
      "ticking the last open item below a done one moves it first",
      "- [x] A\n- [ ] B",
      "B",
      "- [x] B\n- [x] A",
    ],
    [
      "ticking leads the done items, which keep their order",
      "- [ ] A\n- [ ] B\n- [x] C\n- [x] D",
      "A",
      "- [ ] B\n- [x] A\n- [x] C\n- [x] D",
    ],
    [
      "unticking moves it to the end of the open items",
      "- [ ] A\n- [x] B\n- [x] C",
      "C",
      "- [ ] A\n- [ ] C\n- [x] B",
    ],
    [
      "unticking when every item is done moves it first",
      "- [x] A\n- [x] B",
      "B",
      "- [ ] B\n- [x] A",
    ],
    [
      "a nested child moves only within its own sublist",
      "- [ ] P\n  - [ ] c1\n  - [ ] c2\n- [ ] Q",
      "c1",
      "- [ ] P\n  - [ ] c2\n  - [x] c1\n- [ ] Q",
    ],
    [
      "a parent moves with its children",
      "- [ ] P\n  - [ ] c1\n  - [x] c2\n- [ ] Q",
      "P",
      "- [ ] Q\n- [x] P\n  - [ ] c1\n  - [x] c2",
    ],
    [
      "a task list next to a bullet list leaves the bullets alone",
      "- one\n- two\n\nThen\n\n- [ ] A\n- [ ] B",
      "A",
      "- one\n- two\n\nThen\n\n- [ ] B\n- [x] A",
    ],
    [
      "a task list inside a blockquote",
      "> - [ ] A\n> - [ ] B",
      "A",
      "> - [ ] B\n> - [x] A",
    ],
  ] as const)("%s", (_name, before, item, after) => {
    const state = stateFor(before);
    expect(markdownOf(state.apply(toggle(state, item)))).toBe(after);
  });
});

describe("nothing moves", () => {
  test.each([
    [
      "ticking the last open item already above the done ones",
      "- [ ] A\n- [x] B",
      "A",
      "- [x] A\n- [x] B",
    ],
    [
      "unticking an item already at the end of the open ones",
      "- [ ] A\n- [x] B\n- [x] C",
      "B",
      "- [ ] A\n- [ ] B\n- [x] C",
    ],
    ["a list with one item", "- [ ] A", "A", "- [x] A"],
  ] as const)("%s", (_name, before, item, after) => {
    const state = stateFor(before);
    const tr = toggle(state, item);
    const next = state.apply(tr);
    expect(moveToggledTaskItem(next, tr)).toBeNull();
    expect(markdownOf(next)).toBe(after);
  });

  test("an external sync of a toggled item", () => {
    const state = stateFor("- [ ] A\n- [ ] B");
    const tr = toggle(state, "A").setMeta("teakExternalSync", true);
    expect(markdownOf(state.apply(tr))).toBe("- [x] A\n- [ ] B");
  });

  test("a paste", () => {
    const state = stateFor("- [ ] A\n- [ ] B");
    const tr = toggle(state, "A").setMeta("uiEvent", "paste");
    expect(markdownOf(state.apply(tr))).toBe("- [x] A\n- [ ] B");
  });

  test("an edit to an item's text", () => {
    const state = stateFor("- [ ] A\n- [ ] B");
    const tr = state.tr.insertText("!", taskItemPos(state.doc, "A") + 3);
    expect(markdownOf(state.apply(tr))).toBe("- [ ] A!\n- [ ] B");
  });

  test("a note that loads as literal Markdown has no task items", () => {
    const prepared = prepareMarkdownDocument(
      "| a | b |\n| - | - |\n| 1 | 2 |\n\n- [ ] A\n- [ ] B"
    );
    expect(prepared.literal).toBe(true);
  });
});

test("one undo restores the tick and the position", () => {
  const before = "- [ ] A\n- [ ] B\n- [ ] C";
  let state = stateFor(before);
  state = state.apply(toggle(state, "A"));
  expect(markdownOf(state)).toBe("- [ ] B\n- [ ] C\n- [x] A");
  undo(state, (tr) => {
    state = state.apply(tr);
  });
  expect(markdownOf(state)).toBe(before);
});

test("a caret inside the moved item moves with it", () => {
  let state = stateFor("- [ ] Alpha\n- [ ] Beta");
  const caret = taskItemPos(state.doc, "Alpha") + 4; // between "Al" and "pha"
  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, caret))
  );
  state = state.apply(toggle(state, "Alpha"));
  const { $from } = state.selection;
  expect($from.parent.textContent).toBe("Alpha");
  expect($from.parentOffset).toBe(2);
});

test.each([
  [[false, false, false], 0, [1, 2, 0]],
  [[true, false], 1, [1, 0]],
  [[false, true], 0, [0, 1]],
  [[true, true], 1, [1, 0]],
  [[false, true, true], 2, [0, 2, 1]],
] as const)("orders %p with item %p toggled as %p", (checked, index, order) => {
  expect(sortedTaskOrder(checked, index)).toEqual([...order]);
});

test("a caret in another item of the moved run stays in that item", () => {
  let state = stateFor("- [ ] Alpha\n- [ ] Beta\n- [ ] Gamma");
  const caret = taskItemPos(state.doc, "Beta") + 4; // between "Be" and "ta"
  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, caret))
  );
  state = state.apply(toggle(state, "Alpha"));
  expect(markdownOf(state)).toBe("- [ ] Beta\n- [ ] Gamma\n- [x] Alpha");
  const { $from } = state.selection;
  expect($from.parent.textContent).toBe("Beta");
  expect($from.parentOffset).toBe(2);
});
