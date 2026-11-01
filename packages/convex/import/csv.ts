import { ImportLimitExceeded } from "./sourceItems";

const MAX_CSV_ROWS = 10_000;
const MAX_CSV_COLUMNS = 256;
/** Rows re-read after an unclosed quote before every quote ends at its line. */
const MAX_QUOTE_RECOVERIES = 3;

export type CsvDelimiter = "," | ";" | "\t";

export interface CsvLimits {
  delimiter?: CsvDelimiter;
  maxRows?: number;
}

/** What made a row unreliable; the row is still returned. */
export type CsvRowProblem = "unclosed_quote" | "text_after_quote";

export interface CsvRecords {
  numbers: number[];
  /** Row index (into `rows`) to what was wrong with that row. */
  problems: Map<number, CsvRowProblem>;
  rows: string[][];
}

/**
 * RFC 4180: quoted fields, embedded commas and newlines, `""` escaping, and
 * CRLF/LF/CR line endings.
 */
export function parseCsvRows(input: string, limits?: CsvLimits): string[][] {
  return parseCsvRecords(input, limits).rows;
}

interface ScanOptions {
  delimiter: CsvDelimiter;
  /** `first`: the first row's quotes end at its line; `all`: every row's. */
  lineQuotes: false | "first" | "all";
  maxRows: number;
}

/**
 * Reads records from `from`. When a quote is still open at the end of the
 * input, returns where its row started, so the caller can read that row
 * again with the quote ended at its line.
 */
function scanCsv(
  input: string,
  from: number,
  recordsBefore: number,
  options: ScanOptions,
  out: CsvRecords
): { records: number; rowStart: number } | null {
  const { delimiter, maxRows } = options;
  const length = input.length;
  let lineQuotes = options.lineQuotes !== false;
  let records = recordsBefore;
  let row: string[] = [];
  let parts: string[] = [];
  let problem: CsvRowProblem | undefined;
  let fieldStart = from;
  let rowStart = from;
  let inQuotes = false;
  let quoted = false;
  let index = from;
  const endField = () => {
    if (row.length >= MAX_CSV_COLUMNS) {
      throw new Error("CSV has too many columns");
    }
    parts.push(input.slice(fieldStart, index));
    row.push(parts.length === 1 ? (parts[0] ?? "") : parts.join(""));
    parts = [];
    quoted = false;
    fieldStart = index + 1;
  };
  const endRow = () => {
    endField();
    records += 1;
    if (out.rows.length === 0 || !isEmptyRow(row)) {
      if (out.rows.length > maxRows) {
        throw new ImportLimitExceeded(
          `CSV exceeds ${maxRows.toLocaleString("en-US")} rows`
        );
      }
      if (problem) {
        out.problems.set(out.rows.length, problem);
      }
      out.rows.push(row);
      out.numbers.push(records);
    }
    row = [];
    problem = undefined;
    if (options.lineQuotes === "first") {
      lineQuotes = false;
    }
  };
  while (index < length) {
    const char = input[index];
    const lineBreak = char === "\r" || char === "\n";
    if (inQuotes) {
      if (char === '"') {
        parts.push(input.slice(fieldStart, index));
        if (input[index + 1] === '"') {
          parts.push('"');
          index += 2;
        } else {
          inQuotes = false;
          index += 1;
        }
        fieldStart = index;
        continue;
      }
      if (!(lineQuotes && lineBreak)) {
        index += 1;
        continue;
      }
      // This quote never closes, so it ends with its line.
      inQuotes = false;
      problem = "unclosed_quote";
    }
    if (char === '"' && index === fieldStart && !quoted && !parts.length) {
      inQuotes = true;
      quoted = true;
      index += 1;
      fieldStart = index;
      continue;
    }
    if (char === delimiter) {
      endField();
    } else if (lineBreak) {
      endRow();
      if (char === "\r" && input[index + 1] === "\n") {
        index += 1;
        fieldStart = index + 1;
      }
      rowStart = index + 1;
    } else if (quoted && char !== " ") {
      // `"a"b`: RFC 4180 allows nothing between a closing quote and the
      // separator.
      problem ??= "text_after_quote";
    }
    index += 1;
  }
  if (inQuotes) {
    if (!lineQuotes) {
      return { records, rowStart };
    }
    problem = "unclosed_quote";
  }
  if (fieldStart < length || parts.length || row.length) {
    endRow();
  }
  return null;
}

/**
 * `parseCsvRows`, plus each row's record number as a spreadsheet shows it:
 * blank records are skipped but still counted, and a quoted cell spanning
 * several lines stays one record.
 *
 * Lenient where RFC 4180 is strict, and every such row is listed in
 * `problems`: a quote only opens at the start of a cell (`5" screen` keeps
 * its quote), text after a closing quote stays in the cell, and a quote still
 * open at the end of the file ends with its own line instead of swallowing
 * every row after it.
 */
export function parseCsvRecords(
  input: string,
  { maxRows = MAX_CSV_ROWS, delimiter = "," }: CsvLimits = {}
): CsvRecords {
  const out: CsvRecords = { numbers: [], problems: new Map(), rows: [] };
  let from = 0;
  let records = 0;
  for (let attempt = 0; ; attempt += 1) {
    let lineQuotes: ScanOptions["lineQuotes"] = "first";
    if (attempt === 0) {
      lineQuotes = false;
    } else if (attempt > MAX_QUOTE_RECOVERIES) {
      lineQuotes = "all";
    }
    const unclosed = scanCsv(
      input,
      from,
      records,
      { delimiter, lineQuotes, maxRows },
      out
    );
    if (!unclosed) {
      return out;
    }
    from = unclosed.rowStart;
    records = unclosed.records;
  }
}

/**
 * The separator a spreadsheet used: a comma, unless the header line has none
 * and has semicolons or tabs instead (Excel writes semicolons in many
 * European locales).
 */
export function detectCsvDelimiter(input: string): CsvDelimiter {
  const header =
    input
      .split(/\r\n|\r|\n/, 20)
      .find((line) => line.trim() !== "")
      ?.replace(/"(?:[^"]|"")*"/g, "") ?? "";
  const count = (character: string) => header.split(character).length - 1;
  if (count(",") > 0) {
    return ",";
  }
  const tabs = count("\t");
  const semicolons = count(";");
  if (tabs === 0 && semicolons === 0) {
    return ",";
  }
  return tabs > semicolons ? "\t" : ";";
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
