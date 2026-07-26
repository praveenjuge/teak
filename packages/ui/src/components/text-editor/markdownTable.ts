import type { EditorView } from "@codemirror/view";
import { WidgetType } from "@codemirror/view";

export type MarkdownTableAlignment = "center" | "left" | "right";

export interface MarkdownTableData {
  alignments: MarkdownTableAlignment[];
  headers: string[];
  rows: string[][];
}

function splitTableRow(line: string) {
  const trimmed = line.trim();
  const withoutEdges = trimmed.replace(/^\|/u, "").replace(/(?<!\\)\|$/u, "");
  const cells: string[] = [];
  let cell = "";

  for (let index = 0; index < withoutEdges.length; index += 1) {
    const character = withoutEdges[index];
    if (character === "\\" && withoutEdges[index + 1] === "|") {
      cell += "|";
      index += 1;
    } else if (character === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function alignmentFor(delimiter: string): MarkdownTableAlignment | null {
  const value = delimiter.trim();
  if (!/^:?-{3,}:?$/u.test(value)) {
    return null;
  }
  if (value.startsWith(":") && value.endsWith(":")) {
    return "center";
  }
  return value.endsWith(":") ? "right" : "left";
}

export function parseMarkdownTable(source: string): MarkdownTableData | null {
  const lines = source.trim().split(/\r?\n/u);
  if (lines.length < 2) {
    return null;
  }

  const headers = splitTableRow(lines[0] ?? "");
  const delimiterCells = splitTableRow(lines[1] ?? "");
  if (headers.length === 0 || delimiterCells.length !== headers.length) {
    return null;
  }

  const alignments = delimiterCells.map(alignmentFor);
  if (alignments.some((alignment) => alignment === null)) {
    return null;
  }

  const rows = lines.slice(2).map((line) => {
    const cells = splitTableRow(line);
    return headers.map((_, index) => cells[index] ?? "");
  });

  return {
    alignments: alignments as MarkdownTableAlignment[],
    headers,
    rows,
  };
}

function appendCellContent(cell: HTMLTableCellElement, value: string) {
  const inlineCode = /^`([^`]+)`$/u.exec(value);
  if (inlineCode?.[1]) {
    const code = document.createElement("code");
    code.textContent = inlineCode[1];
    cell.append(code);
    return;
  }
  cell.textContent = value;
}

export class MarkdownTableWidget extends WidgetType {
  readonly from: number;
  readonly table: MarkdownTableData;

  constructor(from: number, table: MarkdownTableData) {
    super();
    this.from = from;
    this.table = table;
  }

  eq(other: MarkdownTableWidget) {
    return (
      other.from === this.from &&
      JSON.stringify(other.table) === JSON.stringify(this.table)
    );
  }

  toDOM(view: EditorView) {
    const shell = document.createElement("div");
    shell.className = "cm-md-table-shell";
    shell.title = "Click to edit Markdown table";

    const table = document.createElement("table");
    table.className = "cm-md-table";
    table.setAttribute("aria-label", "Markdown table");

    const head = table.createTHead();
    const headerRow = head.insertRow();
    this.table.headers.forEach((value, index) => {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.style.textAlign = this.table.alignments[index] ?? "left";
      appendCellContent(cell, value);
      headerRow.append(cell);
    });

    const body = table.createTBody();
    for (const row of this.table.rows) {
      const tableRow = body.insertRow();
      row.forEach((value, index) => {
        const cell = tableRow.insertCell();
        cell.style.textAlign = this.table.alignments[index] ?? "left";
        appendCellContent(cell, value);
      });
    }

    shell.append(table);
    shell.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.dispatch({
        scrollIntoView: true,
        selection: { anchor: this.from },
      });
      view.focus();
    });
    return shell;
  }

  ignoreEvent() {
    return true;
  }
}
