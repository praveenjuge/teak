import { Parser } from "htmlparser2";
import type { ParsedBookmarkItem } from "./bookmarks";
import { readCsvTable } from "./csv";
import { linkItem, notAnExport, parseSourceDate } from "./sourceItems";

const SOURCE = "Pocket";

function parsePocketCsv(csv: string): ParsedBookmarkItem[] {
  const table = readCsvTable(csv);
  if (!(table.has("url") && table.has("time_added"))) {
    notAnExport(SOURCE);
  }
  return table.rows.map((row) =>
    linkItem(SOURCE, {
      url: table.cell(row, "url"),
      title: table.cell(row, "title"),
      tags: table.cell(row, "tags").split("|"),
      createdAt: parseSourceDate(table.cell(row, "time_added")),
      isArchived: table.cell(row, "status").toLowerCase() === "archive",
    })
  );
}

function parsePocketHtml(html: string): ParsedBookmarkItem[] {
  const output: ParsedBookmarkItem[] = [];
  let heading: string[] | undefined;
  let archived = false;
  let sawSection = false;
  let anchor:
    | { attributes: Record<string, string>; text: string[] }
    | undefined;
  const parser = new Parser(
    {
      onopentag(name, attributes) {
        if (name === "h1") {
          heading = [];
        }
        if (name === "a") {
          anchor = { attributes, text: [] };
        }
      },
      ontext(text) {
        heading?.push(text);
        anchor?.text.push(text);
      },
      onclosetag(name) {
        if (name === "h1" && heading) {
          const title = heading.join("").trim().toLowerCase();
          archived = title.includes("archive");
          sawSection ||= title === "unread" || title.includes("archive");
          heading = undefined;
        }
        if (name === "a" && anchor) {
          if (output.length >= 10_000) {
            throw new Error("Pocket export exceeds 10,000 items");
          }
          output.push(
            linkItem(SOURCE, {
              url: anchor.attributes.href ?? "",
              title: anchor.text.join(""),
              tags: (anchor.attributes.tags ?? "").split(","),
              createdAt: parseSourceDate(anchor.attributes.time_added),
              isArchived: archived,
            })
          );
          anchor = undefined;
        }
      },
    },
    { decodeEntities: true }
  );
  parser.end(html);
  if (!sawSection) {
    notAnExport(SOURCE);
  }
  return output;
}

/** Pocket exports: the CSV, or the older HTML file. */
export function parsePocketExport(text: string): ParsedBookmarkItem[] {
  return text.trimStart().startsWith("<")
    ? parsePocketHtml(text)
    : parsePocketCsv(text);
}
