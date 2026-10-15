/**
 * `cards.csv` for the export ZIP: one row per card (RFC 4180), safe to open
 * in Excel, Numbers and Google Sheets.
 *
 * Every cell is quoted, rows end in CRLF, and the file starts with a UTF-8
 * byte order mark so Excel reads emoji, RTL and CJK text correctly. A cell a
 * spreadsheet would run as a formula gets a leading apostrophe. List cells
 * (tags, folders) are joined with ", "; `cards.json` keeps the exact values.
 */

import type { SerializedCard } from "./serialize";

export const CSV_COLUMNS = [
  "id",
  "type",
  "title",
  "url",
  "content",
  "notes",
  "tags",
  "aiTags",
  "aiSummary",
  "folders",
  "isFavorited",
  "isArchived",
  "createdAt",
] as const;

const BOM = "﻿";

const FORMULA_START = /^[=+\-@\t\r]/;

/** The cell as written: formula-guarded, then quoted with `"` doubled. */
export const csvCell = (value: string): string => {
  const guarded = FORMULA_START.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
};

const row = (card: SerializedCard): string[] => [
  card.id,
  card.type,
  card.metadataTitle ?? "",
  card.url ?? "",
  card.content,
  card.notes ?? "",
  card.tags.join(", "),
  card.aiTags.join(", "),
  card.aiSummary ?? "",
  card.folders.join(", "),
  String(card.isFavorited),
  String(card.isArchived),
  card.createdAt.iso,
];

/** Builds the CSV file: a header row, then one row per card in order. */
export function buildCardsCsv(cards: readonly SerializedCard[]): string {
  const lines = [CSV_COLUMNS.map(csvCell).join(",")];
  for (const card of cards) {
    lines.push(row(card).map(csvCell).join(","));
  }
  return `${BOM}${lines.join("\r\n")}\r\n`;
}
