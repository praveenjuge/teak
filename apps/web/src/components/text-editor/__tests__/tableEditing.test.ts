import { afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({ url: "http://localhost:3000" });

const { Editor } = await import("@tiptap/core");
const { Markdown } = await import("@tiptap/markdown");
const { TextSelection } = await import("@tiptap/pm/state");
const { documentExtensions, prepareMarkdownDocument } = await import(
  "../markdownDocument"
);
const {
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
  insertNewTable,
  pasteIntoTable,
  TableKeys,
  tableActions,
  tableAt,
} = await import("../tableEditing");

type TestEditor = InstanceType<typeof Editor>;

let editor: TestEditor | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

const table = (rows: string[][]) =>
  [
    `| ${rows[0].join(" | ")} |`,
    `| ${rows[0].map(() => "---").join(" | ")} |`,
    ...rows.slice(1).map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");

function open(markdown: string, suggesting = false) {
  const prepared = prepareMarkdownDocument(markdown);
  expect(prepared.literal).toBe(false);
  editor = new Editor({
    element: document.createElement("div"),
    extensions: [
      ...documentExtensions(),
      TableKeys(() => suggesting),
      Markdown,
    ],
    content: prepared.document,
  });
  return editor;
}

/** Puts the cursor at the end of the cell's text. */
function cursorIn(current: TestEditor, row: number, col: number) {
  let found = -1;
  current.state.doc.descendants((node, pos) => {
    if (node.type.name !== "table" || found >= 0) {
      return node.type.name !== "table";
    }
    let index = 0;
    node.forEach((rowNode, rowOffset) => {
      rowNode.forEach((cell, cellOffset, cellIndex) => {
        if (index === row && cellIndex === col) {
          found = pos + 1 + rowOffset + 1 + cellOffset + cell.nodeSize - 2;
        }
      });
      index += 1;
    });
    return false;
  });
  if (found < 0) {
    throw new Error(`No cell at ${row}, ${col}`);
  }
  current.view.dispatch(
    current.state.tr.setSelection(
      TextSelection.create(current.state.doc, found)
    )
  );
}

const place = (current: TestEditor) => {
  const at = tableAt(current.state);
  return at ? [at.row, at.col] : null;
};

/** A keydown through ProseMirror's handlers, as a real key press runs. */
const press = (current: TestEditor, key: string, shiftKey = false) =>
  Boolean(
    current.view.someProp("handleKeyDown", (handle) =>
      handle(current.view, new KeyboardEvent("keydown", { key, shiftKey }))
    )
  );

/** Markdown with table padding ignored. */
const tidy = (markdown: string) =>
  markdown
    .split("\n")
    .map((line) =>
      line.startsWith("|")
        ? line.replace(/ +/g, " ").replace(/-{3,}/g, "---")
        : line
    )
    .join("\n");

describe("inserting", () => {
  test("/table makes a 3×3 table with a header row, saved as GFM", () => {
    const current = open("Before\n\n/table");
    const end = current.state.doc.content.size - 1;
    insertNewTable(current, { from: end - 6, to: end });
    expect(place(current)).toEqual([0, 0]);
    current.commands.insertContent("Name");
    const markdown = current.getMarkdown();
    expect(markdown).toContain("| Name |");
    expect(
      markdown.split("\n").filter((line) => line.startsWith("|"))
    ).toHaveLength(4);
    expect(prepareMarkdownDocument(markdown).literal).toBe(false);
  });

  test("an empty header cell with the cursor shows Header", () => {
    const current = open("Before");
    const end = current.state.doc.content.size - 1;
    insertNewTable(current, { from: end, to: end });
    const placeholder = current.view.dom.querySelector("th .is-empty");
    expect(placeholder?.getAttribute("data-placeholder")).toBe("Header");
    current.commands.insertContent("Name");
    expect(current.view.dom.querySelector("th .is-empty")).toBeNull();
  });
});

describe("tables stay top level and single line", () => {
  test("/table in a list item goes after the list, which stays whole", () => {
    const current = open("- First /table\n- Second");
    insertNewTable(current, { from: 9, to: 15 });
    expect(place(current)).toEqual([0, 0]);
    current.commands.insertContent("Name");
    const markdown = current.getMarkdown();
    expect(tidy(markdown)).toBe(
      tidy(
        `- First \n- Second\n\n${table([
          ["Name", "", ""],
          ["", "", ""],
          ["", "", ""],
        ])}`
      )
    );
    expect(prepareMarkdownDocument(markdown).literal).toBe(false);
  });

  test("a table can't sit in a list item, even when a command puts it there", () => {
    const current = open("- First\n- Second");
    current.commands.setTextSelection(8);
    current.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });
    const { doc } = current.state;
    const topLevel = Array.from(
      { length: doc.childCount },
      (_, index) => doc.child(index).type.name
    );
    expect(topLevel).toContain("table");
    expect(prepareMarkdownDocument(current.getMarkdown()).literal).toBe(false);
  });

  test("a line break in a cell becomes a space", () => {
    const current = open(table([["A"], ["1"]]));
    cursorIn(current, 1, 0);
    current.commands.setHardBreak();
    current.commands.insertContent("2");
    expect(tidy(current.getMarkdown())).toBe(tidy(table([["A"], ["1 2"]])));
  });

  test("a line break outside a table stays", () => {
    const current = open("First");
    current.commands.setTextSelection(current.state.doc.content.size - 1);
    current.commands.setHardBreak();
    current.commands.insertContent("Second");
    expect(current.getMarkdown()).toBe("First  \nSecond");
  });
});

describe("pasting into a cell", () => {
  const paste = (current: TestEditor, text: string) => {
    const prepared = prepareMarkdownDocument(text);
    return pasteIntoTable(
      current,
      text,
      prepared.literal ? null : (prepared.document.content ?? [])
    );
  };

  test("lines become one line of the cell", () => {
    const current = open(table([["A"], ["1"]]));
    cursorIn(current, 1, 0);
    expect(paste(current, " one\ntwo\n\nthree")).toBe(true);
    expect(tidy(current.getMarkdown())).toBe(
      tidy(table([["A"], ["1 one two three"]]))
    );
  });

  test("soft line breaks in one paragraph become spaces", () => {
    const current = open(table([["A"], ["1"]]));
    cursorIn(current, 1, 0);
    paste(current, " one\ntwo\nthree");
    expect(tidy(current.getMarkdown())).toBe(
      tidy(table([["A"], ["1 one two three"]]))
    );
  });

  test("one paragraph keeps its formatting", () => {
    const current = open(table([["A"], ["1"]]));
    cursorIn(current, 1, 0);
    paste(current, " **bold** and [Teak](https://teakvault.com)");
    expect(tidy(current.getMarkdown())).toBe(
      tidy(table([["A"], ["1 **bold** and [Teak](https://teakvault.com)"]]))
    );
  });

  test("a pasted table goes after the table, which stays whole", () => {
    const current = open(`${table([["A"], ["1"]])}\n\nAfter`);
    cursorIn(current, 1, 0);
    paste(current, table([["X"], ["2"]]));
    expect(tidy(current.getMarkdown())).toBe(
      tidy(`${table([["A"], ["1"]])}\n\n${table([["X"], ["2"]])}\n\nAfter`)
    );
  });

  test("outside a table it leaves the paste to the editor", () => {
    const current = open("Text");
    expect(paste(current, "a\nb")).toBe(false);
  });
});

describe("keys", () => {
  const twoByTwo = table([
    ["A", "B"],
    ["1", "2"],
  ]);

  test("Enter moves down the column and adds a row from the last one", () => {
    const current = open(twoByTwo);
    cursorIn(current, 0, 1);
    expect(press(current, "Enter")).toBe(true);
    expect(place(current)).toEqual([1, 1]);
    expect(press(current, "Enter")).toBe(true);
    expect(place(current)).toEqual([2, 1]);
    expect(tidy(current.getMarkdown())).toBe(
      tidy(
        table([
          ["A", "B"],
          ["1", "2"],
          ["", ""],
        ])
      )
    );
  });

  test("Enter never splits a cell", () => {
    const current = open(twoByTwo);
    cursorIn(current, 1, 0);
    press(current, "Enter", true);
    expect(current.getMarkdown()).not.toContain("<br");
    expect(prepareMarkdownDocument(current.getMarkdown()).literal).toBe(false);
  });

  test("Tab moves on, Shift+Tab moves back, and Tab in the last cell adds a row", () => {
    const current = open(twoByTwo);
    cursorIn(current, 0, 0);
    press(current, "Tab");
    expect(place(current)).toEqual([0, 1]);
    press(current, "Tab", true);
    expect(place(current)).toEqual([0, 0]);
    cursorIn(current, 1, 1);
    press(current, "Tab");
    expect(place(current)).toEqual([2, 0]);
    expect(tableAt(current.state)?.rows).toBe(3);
  });

  test("an open slash or [[ menu keeps Enter", () => {
    const current = open(twoByTwo, true);
    cursorIn(current, 1, 1);
    press(current, "Enter");
    expect(place(current)).toEqual([1, 1]);
    expect(tableAt(current.state)?.rows).toBe(2);
  });

  test("Backspace removes a table whose cells are all empty", () => {
    const current = open(
      `Before\n\n${table([
        ["", ""],
        ["", ""],
      ])}`
    );
    cursorIn(current, 0, 0);
    expect(press(current, "Backspace")).toBe(true);
    expect(current.state.doc.textContent).toBe("Before");
    expect(current.getMarkdown()).not.toContain("|");
  });

  test("Backspace in an empty cell of a table with text leaves the table", () => {
    const current = open(
      table([
        ["A", ""],
        ["", ""],
      ])
    );
    cursorIn(current, 0, 1);
    press(current, "Backspace");
    expect(tidy(current.getMarkdown())).toBe(
      tidy(
        table([
          ["A", ""],
          ["", ""],
        ])
      )
    );
  });
});

describe("the ⋯ menu", () => {
  const grid = table([
    ["A", "B", "C"],
    ["1", "2", "3"],
    ["4", "5", "6"],
  ]);
  const run = (current: TestEditor, action: string) =>
    (current.commands as unknown as Record<string, () => boolean>)[action]();

  test.each([
    [
      "addRowBefore",
      [1, 1],
      table([
        ["A", "B", "C"],
        ["", "", ""],
        ["1", "2", "3"],
        ["4", "5", "6"],
      ]),
    ],
    [
      "addRowAfter",
      [1, 1],
      table([
        ["A", "B", "C"],
        ["1", "2", "3"],
        ["", "", ""],
        ["4", "5", "6"],
      ]),
    ],
    [
      "addColumnBefore",
      [1, 1],
      table([
        ["A", "", "B", "C"],
        ["1", "", "2", "3"],
        ["4", "", "5", "6"],
      ]),
    ],
    [
      "addColumnAfter",
      [1, 1],
      table([
        ["A", "B", "", "C"],
        ["1", "2", "", "3"],
        ["4", "5", "", "6"],
      ]),
    ],
    [
      "deleteRow",
      [1, 1],
      table([
        ["A", "B", "C"],
        ["4", "5", "6"],
      ]),
    ],
    [
      "deleteColumn",
      [1, 1],
      table([
        ["A", "C"],
        ["1", "3"],
        ["4", "6"],
      ]),
    ],
  ] as const)("%s", (action, [row, col], expected) => {
    const current = open(grid);
    cursorIn(current, row, col);
    const state = tableActions(tableAt(current.state)!).find(
      (item) => item.action === action
    );
    expect(state?.disabled).toBeUndefined();
    expect(run(current, action)).toBe(true);
    const markdown = current.getMarkdown();
    expect(tidy(markdown)).toBe(tidy(expected));
    expect(prepareMarkdownDocument(markdown).literal).toBe(false);
  });

  test("deleteTable removes it and keeps the text around it", () => {
    const current = open(`Before\n\n${grid}\n\nAfter`);
    cursorIn(current, 1, 1);
    expect(run(current, "deleteTable")).toBe(true);
    expect(current.getMarkdown()).toBe("Before\n\nAfter");
  });

  test("the header row can't move or go, and the last column can't go", () => {
    const current = open(table([["A"], ["1"]]));
    cursorIn(current, 0, 0);
    const disabled = Object.fromEntries(
      tableActions(tableAt(current.state)!).map((item) => [
        item.action,
        item.disabled,
      ])
    );
    expect(disabled).toEqual({
      addRowBefore: "The header row stays the first row",
      addRowAfter: undefined,
      addColumnBefore: undefined,
      addColumnAfter: undefined,
      deleteRow: "The header row can't be deleted",
      deleteColumn: "Delete the table to remove its last column",
      deleteTable: undefined,
    });
  });

  test(`at ${MAX_TABLE_COLUMNS} columns and ${MAX_TABLE_ROWS} rows the add actions are off`, () => {
    const header = Array.from({ length: MAX_TABLE_COLUMNS }, (_, i) => `H${i}`);
    const rows = Array.from({ length: MAX_TABLE_ROWS - 1 }, (_, r) =>
      header.map((_, c) => `${r}.${c}`)
    );
    const current = open(table([header, ...rows]));
    cursorIn(current, 5, 5);
    const disabled = Object.fromEntries(
      tableActions(tableAt(current.state)!).map((item) => [
        item.action,
        item.disabled,
      ])
    );
    expect(disabled.addRowBefore).toBe("Tables can have up to 200 rows");
    expect(disabled.addRowAfter).toBe("Tables can have up to 200 rows");
    expect(disabled.addColumnBefore).toBe("Tables can have up to 20 columns");
    expect(disabled.addColumnAfter).toBe("Tables can have up to 20 columns");

    cursorIn(current, MAX_TABLE_ROWS - 1, MAX_TABLE_COLUMNS - 1);
    expect(press(current, "Tab")).toBe(true);
    expect(press(current, "Enter")).toBe(true);
    expect(tableAt(current.state)?.rows).toBe(MAX_TABLE_ROWS);
  });
});
