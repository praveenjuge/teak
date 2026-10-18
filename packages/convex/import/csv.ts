import { ImportLimitExceeded } from "./sourceItems";

const MAX_CSV_ROWS = 10_000;

export interface CsvLimits {
  maxRows?: number;
}

/**
 * RFC 4180: quoted fields, embedded commas and newlines, `""` escaping, and
 * CRLF/LF/CR line endings.
 */
export function parseCsvRows(
  input: string,
  { maxRows = MAX_CSV_ROWS }: CsvLimits = {}
): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let pieces: string[] = [];
  let blocks: string[] = [];
  let pieceLength = 0;
  const appendPiece = (piece: string) => {
    pieces.push(piece);
    pieceLength += piece.length;
    if (pieceLength >= 65_536 || pieces.length >= 1024) {
      blocks.push(pieces.join(""));
      pieces = [];
      pieceLength = 0;
    }
  };
  let fieldStart = 0;
  let inQuotes = false;
  let index = 0;
  const length = input.length;
  const endField = () => {
    if (row.length >= 256) {
      throw new Error("CSV has too many columns");
    }
    appendPiece(input.slice(fieldStart, index));
    blocks.push(pieces.join(""));
    row.push(blocks.join(""));
    pieces = [];
    blocks = [];
    pieceLength = 0;
    fieldStart = index + 1;
  };
  const endRow = () => {
    endField();
    if (rows.length === 0 || !isEmptyRow(row)) {
      if (rows.length > maxRows) {
        throw new ImportLimitExceeded(
          `CSV exceeds ${maxRows.toLocaleString("en-US")} rows`
        );
      }
      rows.push(row);
    }
    row = [];
  };
  while (index < length) {
    const char = input[index];
    if (char === '"') {
      appendPiece(input.slice(fieldStart, index));
      if (inQuotes && input[index + 1] === '"') {
        appendPiece('"');
        index += 2;
      } else {
        inQuotes = !inQuotes;
        index += 1;
      }
      fieldStart = index;
      continue;
    }
    if (!inQuotes && char === ",") {
      endField();
    }
    if (!inQuotes && (char === "\r" || char === "\n")) {
      endRow();
      if (char === "\r" && input[index + 1] === "\n") {
        index += 1;
        fieldStart = index + 1;
      }
    }
    index += 1;
  }
  if (fieldStart < length || pieces.length || blocks.length || row.length) {
    endRow();
  }
  return rows;
}

export function isEmptyRow(row: string[]): boolean {
  return row.every((cell) => cell.trim() === "");
}

export interface CsvTable {
  cell: (row: string[], column: string) => string;
  has: (column: string) => boolean;
  rows: string[][];
}

export function readCsvTable(input: string, limits?: CsvLimits): CsvTable {
  const text = input.charCodeAt(0) === 0xfe_ff ? input.slice(1) : input;
  const [header, ...rows] = parseCsvRows(text, limits);
  if (!header || isEmptyRow(header)) {
    throw new Error("CSV is empty");
  }
  const columns = new Map<string, number>();
  header.forEach((name, index) => {
    const key = name.trim().toLowerCase();
    if (key && !columns.has(key)) {
      columns.set(key, index);
    }
  });
  return {
    has: (column) => columns.has(column.toLowerCase()),
    cell: (row, column) => {
      const index = columns.get(column.toLowerCase());
      return index === undefined ? "" : (row[index] ?? "").trim();
    },
    rows: rows.filter((row) => !isEmptyRow(row)),
  };
}
