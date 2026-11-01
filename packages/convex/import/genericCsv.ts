import { IMPORT_FAILURE } from "../shared/importSources";
import type { ParsedBookmarkItem } from "./bookmarks";
import { type CsvRowProblem, detectCsvDelimiter, parseCsvRecords } from "./csv";
import {
  folderPath,
  linkItem,
  notAnExport,
  parseSourceDate,
} from "./sourceItems";

const SOURCE = "CSV";

const ROW_PROBLEMS: Record<CsvRowProblem, string> = {
  unclosed_quote:
    "This row has a quote that is never closed. Close it, or remove it.",
  text_after_quote:
    "This row has text after a closing quote. Put the whole cell inside the quotes.",
};

export type CsvField = "url" | "title" | "tags" | "folder" | "note" | "created";

/**
 * The header names each field answers to. Headers match after trimming,
 * lowercasing and dropping `_`, `-` and spaces, so "Date_Added" and
 * " date added " both mean `created`.
 */
export const CSV_HEADER_ALIASES: Record<CsvField, readonly string[]> = {
  url: ["url", "link", "href", "address", "website"],
  title: ["title", "name"],
  tags: ["tags", "tag", "labels", "keywords"],
  folder: ["folder", "folders", "collection", "category", "list"],
  note: ["note", "notes", "comment", "comments", "description"],
  created: [
    "created",
    "created at",
    "date",
    "date added",
    "added",
    "saved",
    "saved at",
    "time added",
    "timestamp",
  ],
};

export const normalizeCsvHeader = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

const FIELD_BY_HEADER = new Map<string, CsvField>(
  (
    Object.entries(CSV_HEADER_ALIASES) as [CsvField, readonly string[]][]
  ).flatMap(([field, aliases]) =>
    aliases.map((alias) => [normalizeCsvHeader(alias), field] as const)
  )
);

export function splitCsvTags(cell: string): string[] {
  let separator = ";";
  if (cell.includes(",")) {
    separator = ",";
  } else if (cell.includes("|")) {
    separator = "|";
  }
  return cell.split(separator).map((tag) => tag.trim().replace(/^#+/, ""));
}

/**
 * Any comma-, semicolon- or tab-separated CSV (the header line decides) with
 * a header row naming its columns (see
 * `CSV_HEADER_ALIASES`). Unknown columns are ignored; every row becomes a
 * link. Rows are numbered as a spreadsheet shows them, the header being
 * row 1 and blank lines counting.
 */
export function parseGenericCsv(csv: string): ParsedBookmarkItem[] {
  const text = csv.charCodeAt(0) === 0xfe_ff ? csv.slice(1) : csv;
  const {
    numbers,
    problems,
    rows: [header, ...rows],
  } = parseCsvRecords(text, { delimiter: detectCsvDelimiter(text) });
  if (!header || header.every((name) => name.trim() === "")) {
    notAnExport(SOURCE);
  }

  const columns = new Map<CsvField, number>();
  header.forEach((name, index) => {
    const field = FIELD_BY_HEADER.get(normalizeCsvHeader(name));
    if (field && !columns.has(field)) {
      columns.set(field, index);
    }
  });
  if (!columns.has("url")) {
    throw new Error(IMPORT_FAILURE.MISSING_URL_COLUMN);
  }
  if (rows.length === 0) {
    notAnExport(SOURCE);
  }

  const cell = (row: string[], field: CsvField) => {
    const index = columns.get(field);
    return index === undefined ? "" : (row[index] ?? "").trim();
  };

  // Failed rows are listed as the label above the error, so the error doesn't
  // repeat the row number.
  return rows.map((row, index) => {
    const label = `Row ${numbers[index + 1]}`;
    const problem = problems.get(index + 1);
    if (problem) {
      return { label, error: ROW_PROBLEMS[problem] };
    }
    const url = cell(row, "url");
    if (!url) {
      const title = cell(row, "title");
      return title
        ? { label: title, error: `${label} has no url` }
        : { label, error: "This row has no url" };
    }
    const folder = folderPath(cell(row, "folder").split("/"));
    const item = linkItem(SOURCE, {
      url,
      title: cell(row, "title"),
      tags: splitCsvTags(cell(row, "tags")),
      notes: cell(row, "note"),
      folders: folder ? [folder] : undefined,
      createdAt: parseSourceDate(cell(row, "created")),
    });
    return item.error ? { ...item, error: `${label}: ${item.error}` } : item;
  });
}
