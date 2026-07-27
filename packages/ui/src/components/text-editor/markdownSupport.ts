import { indentLess, indentMore } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import type { EditorState, StateCommand } from "@codemirror/state";

export const teakMarkdownSupport = () =>
  markdown({
    addKeymap: false,
    base: markdownLanguage,
  });

function selectionIsInListItem(state: EditorState) {
  return state.selection.ranges.every((selection) => {
    let node: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(
      state
    ).resolveInner(selection.head, -1);
    while (node) {
      if (node.name === "ListItem") {
        return true;
      }
      node = node.parent;
    }
    return false;
  });
}

export const indentMarkdownListItem: StateCommand = (target) =>
  selectionIsInListItem(target.state) && indentMore(target);

export const outdentMarkdownListItem: StateCommand = (target) =>
  selectionIsInListItem(target.state) && indentLess(target);
