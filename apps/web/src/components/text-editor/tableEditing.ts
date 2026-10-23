import {
  type ChainedCommands,
  type Editor,
  Extension,
  type JSONContent,
  type Range,
} from "@tiptap/core";
import { createTable } from "@tiptap/extension-table";
import type { EditorState } from "@tiptap/pm/state";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import { findTable, TableMap } from "@tiptap/pm/tables";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const MAX_TABLE_COLUMNS = 20;
export const MAX_TABLE_ROWS = 200;

export interface TableAt {
  /** The cursor's column and row, counting the header row as 0. */
  col: number;
  cols: number;
  map: TableMap;
  pos: number;
  row: number;
  rows: number;
  start: number;
}

/** The table around the cursor, with the cursor's place in it. */
export function tableAt(state: EditorState): TableAt | null {
  const { $from } = state.selection;
  const table = findTable($from);
  if (!table) {
    return null;
  }
  const map = TableMap.get(table.node);
  const start = table.start;
  let cellPos = -1;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const name = $from.node(depth).type.name;
    if (name === "tableCell" || name === "tableHeader") {
      cellPos = $from.before(depth) - start;
      break;
    }
  }
  const rect = cellPos >= 0 ? map.findCell(cellPos) : null;
  return {
    cols: map.width,
    col: rect?.left ?? 0,
    map,
    pos: table.pos,
    row: rect?.top ?? 0,
    rows: map.height,
    start,
  };
}

export const canAddTableRow = (table: TableAt) => table.rows < MAX_TABLE_ROWS;
export const canAddTableColumn = (table: TableAt) =>
  table.cols < MAX_TABLE_COLUMNS;

/** Moves the cursor into a cell's text. */
const selectCell = (editor: Editor, row: number, col: number): boolean => {
  const table = tableAt(editor.state);
  const node = table && editor.state.doc.nodeAt(table.pos);
  if (!(table && node) || row >= table.rows || col >= table.cols) {
    return false;
  }
  const cellPos = table.start + table.map.positionAt(row, col, node);
  const { tr } = editor.state;
  tr.setSelection(TextSelection.near(tr.doc.resolve(cellPos + 1)));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
};

/**
 * The slash menu's Table: a 3×3 table with a header row and the cursor in
 * its first cell. In a list or quote it goes after the whole block, so the
 * block isn't split around it (tables are top level only).
 */
export function insertNewTable(editor: Editor, range: Range): boolean {
  const $from = editor.state.doc.resolve(range.from);
  const chain = editor.chain().focus().deleteRange(range);
  if ($from.depth <= 1) {
    return chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  }
  // The end of the top-level block, once the slash text is gone.
  const pos = $from.after(1) - (range.to - range.from);
  return chain
    .command(({ tr, state }) => {
      tr.insert(pos, createTable(state.schema, 3, 3, true));
      tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)));
      return true;
    })
    .scrollIntoView()
    .run();
}

/**
 * A paste while the cursor is in a cell. A cell holds one line, so pasted
 * tables go after the table, one paragraph goes in with its formatting, and
 * anything else goes in as one line of plain text. False outside a table.
 */
export function pasteIntoTable(
  editor: Editor,
  text: string,
  blocks: JSONContent[] | null
): boolean {
  const { $from } = editor.state.selection;
  if (!tableAt(editor.state)) {
    return false;
  }
  if (blocks?.some((block) => block.type === "table")) {
    return editor.chain().focus().insertContentAt($from.after(1), blocks).run();
  }
  const [only] = blocks ?? [];
  // Soft line breaks inside a paragraph become spaces too.
  const oneLine = (value: string) => value.replace(/\s*\r?\n\s*/g, " ");
  if (blocks?.length === 1 && only?.type === "paragraph") {
    return editor.commands.insertContent(
      (only.content ?? []).map((node) =>
        node.text ? { ...node, text: oneLine(node.text) } : node
      )
    );
  }
  return editor.commands.insertContent({
    type: "text",
    text: oneLine(text.trimEnd()),
  });
}

/**
 * Puts the cursor in the table that `element` renders, unless it is already
 * there, so a ⋯ menu opened by hover acts on the hovered table and not on
 * another table the cursor was left in.
 */
export function cursorIntoTableElement(
  editor: Editor,
  element: HTMLElement
): void {
  const current = tableAt(editor.state);
  const currentDom = current ? editor.view.nodeDOM(current.pos) : null;
  if (currentDom && (currentDom === element || currentDom.contains(element))) {
    return;
  }
  const cell = element.querySelector("th, td");
  if (!cell) {
    return;
  }
  const pos = editor.view.posAtDOM(cell, 0);
  const { tr } = editor.state;
  editor.view.dispatch(
    tr.setSelection(TextSelection.near(tr.doc.resolve(pos)))
  );
}

const isTableEmpty = (state: EditorState, table: TableAt) =>
  !(state.doc.nodeAt(table.pos)?.textContent ?? "").trim();

/**
 * A GFM cell is one line, so a line break that lands in a cell (a paste, or
 * Shift+Enter from elsewhere) becomes a space; a `<br>` would leave the
 * table literal Markdown when the note reopens.
 */
const singleLineCells = new Plugin({
  appendTransaction: (transactions, _old, state) => {
    if (!transactions.some((transaction) => transaction.docChanged)) {
      return null;
    }
    const breaks: number[] = [];
    state.doc.forEach((block, offset) => {
      if (block.type.name !== "table") {
        return;
      }
      block.descendants((node, pos) => {
        if (node.type.name === "hardBreak") {
          breaks.push(offset + 1 + pos);
        }
      });
    });
    if (!breaks.length) {
      return null;
    }
    const { tr } = state;
    for (const pos of breaks.reverse()) {
      tr.replaceWith(pos, pos + 1, state.schema.text(" "));
    }
    return tr;
  },
});

/** "Header" in an empty header cell while it has the cursor. */
const headerPlaceholder = new Plugin({
  props: {
    decorations: (state) => {
      const { $from, empty } = state.selection;
      if (
        !empty ||
        $from.depth < 1 ||
        $from.parent.content.size > 0 ||
        $from.node($from.depth - 1).type.name !== "tableHeader"
      ) {
        return null;
      }
      const start = $from.before();
      return DecorationSet.create(state.doc, [
        Decoration.node(start, start + $from.parent.nodeSize, {
          class: "is-empty",
          "data-placeholder": "Header",
        }),
      ]);
    },
  },
});

/**
 * Keys inside a table: Enter (and Shift+Enter, since a cell is one line)
 * moves down the column, adding a row from the last one; Tab adds a row only
 * under the row cap; Backspace at the start of an empty table removes it.
 * `isSuggesting` lets an open slash or `[[` menu keep Enter. An empty header
 * cell with the cursor shows "Header".
 */
export const TableKeys = (isSuggesting: (state: EditorState) => boolean) =>
  Extension.create({
    name: "teakTableKeys",
    priority: 200,
    addProseMirrorPlugins() {
      return [singleLineCells, headerPlaceholder];
    },
    addKeyboardShortcuts() {
      const moveDown = () => {
        const table = tableAt(this.editor.state);
        if (!table || isSuggesting(this.editor.state)) {
          return false;
        }
        if (table.row + 1 < table.rows) {
          return selectCell(this.editor, table.row + 1, table.col);
        }
        if (!canAddTableRow(table)) {
          return true;
        }
        this.editor.commands.addRowAfter();
        return selectCell(this.editor, table.row + 1, table.col);
      };
      // At the cap, Tab in the last cell stays put instead of adding a row.
      const stayAtCap = () => {
        const table = tableAt(this.editor.state);
        if (!table || isSuggesting(this.editor.state)) {
          return false;
        }
        const lastCell =
          table.row === table.rows - 1 && table.col === table.cols - 1;
        return lastCell && !canAddTableRow(table);
      };
      const removeEmptyTable = () => {
        const { state } = this.editor;
        const table = tableAt(state);
        if (
          !(table && state.selection.empty) ||
          state.selection.$from.parentOffset > 0 ||
          !isTableEmpty(state, table)
        ) {
          return false;
        }
        return this.editor.commands.deleteTable();
      };
      return {
        Enter: moveDown,
        "Shift-Enter": moveDown,
        Tab: stayAtCap,
        Backspace: removeEmptyTable,
      };
    },
  });

export type TableAction =
  | "addRowBefore"
  | "addRowAfter"
  | "addColumnBefore"
  | "addColumnAfter"
  | "deleteRow"
  | "deleteColumn"
  | "deleteTable";

/** Adds one ⋯ menu action to a command chain. */
export function withTableAction(
  chain: ChainedCommands,
  action: TableAction
): ChainedCommands {
  switch (action) {
    case "addRowBefore":
      return chain.addRowBefore();
    case "addRowAfter":
      return chain.addRowAfter();
    case "addColumnBefore":
      return chain.addColumnBefore();
    case "addColumnAfter":
      return chain.addColumnAfter();
    case "deleteRow":
      return chain.deleteRow();
    case "deleteColumn":
      return chain.deleteColumn();
    case "deleteTable":
      return chain.deleteTable();
    default:
      return chain;
  }
}

export interface TableActionState {
  action: TableAction;
  disabled?: string;
  label: string;
}

/** The ⋯ menu's actions for the cursor's cell, with why any is off. */
export function tableActions(table: TableAt): TableActionState[] {
  const rowCap = canAddTableRow(table)
    ? undefined
    : `Tables can have up to ${MAX_TABLE_ROWS} rows`;
  const columnCap = canAddTableColumn(table)
    ? undefined
    : `Tables can have up to ${MAX_TABLE_COLUMNS} columns`;
  return [
    {
      action: "addRowBefore",
      label: "Add row above",
      disabled:
        rowCap ??
        (table.row === 0 ? "The header row stays the first row" : undefined),
    },
    { action: "addRowAfter", label: "Add row below", disabled: rowCap },
    {
      action: "addColumnBefore",
      label: "Add column left",
      disabled: columnCap,
    },
    {
      action: "addColumnAfter",
      label: "Add column right",
      disabled: columnCap,
    },
    {
      action: "deleteRow",
      label: "Delete row",
      disabled: table.row === 0 ? "The header row can't be deleted" : undefined,
    },
    {
      action: "deleteColumn",
      label: "Delete column",
      disabled:
        table.cols === 1
          ? "Delete the table to remove its last column"
          : undefined,
    },
    { action: "deleteTable", label: "Delete table" },
  ];
}
