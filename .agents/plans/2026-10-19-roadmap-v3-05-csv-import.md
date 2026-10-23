## Goal

Import links from any CSV file whose header names the columns: url, title, tags, folder, note and created, plus common aliases. The plain one-URL-per-line import is relabelled as a general "Text file of links" source. Phase 5 of the [roadmap v3](2026-10-19-roadmap-v3-00-roadmap.md).

## Depends on

- [Phase 2](2026-10-19-roadmap-v3-02-url-key-resave-paste.md): duplicates in the file and against the library match by URL key.

## Success Criteria

- **Settings → Import** lists two new sources:
  - **"CSV file"** (`.csv`): "A CSV with a header row. Teak reads url, title, tags, folder, note and created columns."
  - **"Text file of links"** (`.txt`): "One link per line, optionally followed by ` | Title`. OneTab's Export URLs works too."
- **Recognised headers,** trimmed, case-insensitive, ignoring `_`, `-` and spaces:

  | Field | Header names |
  |---|---|
  | url (required) | url, link, href, address, website |
  | title | title, name |
  | tags | tags, tag, labels, keywords |
  | folder | folder, folders, collection, category, list |
  | note | note, notes, comment, comments, description |
  | created | created, created at, date, date added, added, saved, saved at, time added, timestamp |

- **How values are read:**
  - Unknown columns are ignored.
  - Tags split on commas, or on `|` or `;` when the cell has no comma, with a leading `#` stripped.
  - Folders are flattened into one folder name, as other importers do ("Work / Design").
  - `created` accepts what `parseImportedTimestamp` accepts: ISO dates, `YYYY-MM-DD HH:MM`, and epoch seconds or milliseconds.
- **Rows that can't be imported** (no url, an unsafe url) go to the existing import report, with the row number and the reason.
- **A CSV with no url column** fails with: "This CSV has no url column. Add a header row with a url (or link) column."
- **Duplicates:** existing links are skipped (`DUPLICATE_URL`), and repeats in the file too (`SOURCE_DUPLICATE`), by URL key.
- **Limits:** the existing ones (10,000 items, 20 MB text files, one import at a time).
- **Old jobs:** OneTab import jobs started before the change still show and finish.

## Context And Current Facts

- **Sources:**
  - `packages/convex/shared/importSources.ts` `IMPORT_SOURCES` (lines 18–90) has 10 entries keyed by `ImportMode`. `onetab`: title "OneTab", `.txt`, 20 MB (lines 75–81).
  - The modes come from `FILES_IMPORT_MODES` (`packages/files-protocol/src/index.ts:274–285`).
  - The Convex validator is `importModeValidator` (`schema/validators/jobs.ts`).
- **Parsing:**
  - `import/sources.ts` `parseImportSource` switches on mode (lines 14–40).
  - The Files Worker calls it in `apps/files-worker/src/archives/importSource.ts` (around line 131) and maps `ImportLimitExceeded` to `invalid_bookmark_count`, everything else to `invalid_import_source`.
- **Existing parsers to reuse:**
  - `import/onetab.ts` `parseOneTabText` already reads one `URL | Title` per line, caps at 10,000, and fails with `notAnExport("OneTab")` when there are no links.
  - `import/csv.ts` `parseCsvRows` is RFC 4180, capped at 10,000 rows. `isEmptyRow` skips blank rows.
  - `import/raindrop.ts` (the existing importer) maps a header row to columns (lines 39–58) and uses `folderPath`, `cleanTags` and `parseImportedTimestamp`. It is the closest template.
  - `import/sourceItems.ts` `linkItem` (around line 81) validates the URL (`sanitizeExternalUrl`), caps notes at 100,000 characters, and builds the card. `parseImportedTimestamp` handles the dates.
- **Failure messages:** `describeImportFailure` (`importSources.ts:99–117`) turns `invalid_source` into "This doesn't look like a … export". Failure classes containing spaces pass through as written.
- **UI:**
  - `apps/web/src/components/settings/ImportPanel.tsx` lists every `IMPORT_MODES` entry in a `Select` (lines 491–494) and shows its hint and size (lines 499–500). The `accept` list is derived from the extensions (lines 62–65).
  - The failure report is copied or downloaded at lines 405–437.
- **Duplicate checks:** `dataImport.ts` checks the library (around line 554) and the same file (around line 439). Phase 2 moves both to the URL key.
- **Docs:** `apps/docs/content/docs/(data)/import.mdx`. The sources table has a OneTab row at line 44.

## Constraints And Non-goals

- **No column-mapping UI** (owner decision: known header names).
- **Links only.** A CSV row always becomes a link card; there is no way to make notes from CSV rows.
- **New modes:**
  - `csv` and `links` are added to `FILES_IMPORT_MODES`, `importModeValidator` and `IMPORT_SOURCES`.
  - `onetab` stays in all three, so stored jobs keep validating, but it is hidden from the picker (a `hidden: true` flag on `ImportSource`).
  - `links` reuses `parseOneTabText` with the source label "Text file".
- **Files Worker first:** it parses imports, so it deploys before Convex and web (the `parseImportSource` switch is shared code bundled in the worker).
- **No public API.** Import has none today.

## Backend

- **`packages/files-protocol/src/index.ts`:** add `"csv"` and `"links"` to `FILES_IMPORT_MODES`.
- **`schema.ts`:** add `v.literal("csv")` and `v.literal("links")` to `importModeValidator`.
- **`shared/importSources.ts`:**
  - Add the `csv` and `links` entries (copy in Success Criteria, 20 MB each).
  - Add `hidden?: boolean` to `ImportSource` and set it on `onetab`.
  - Add `IMPORT_FAILURE.MISSING_URL_COLUMN` ("missing_url_column"), described as in Success Criteria.
- **New `import/genericCsv.ts`:**
  - `parseGenericCsv(csv)`:
    1. Strip the BOM.
    2. `parseCsvRows`.
    3. Normalise the headers and look up the aliases (exported `CSV_HEADER_ALIASES`).
    4. Without a url column, throw `new Error(IMPORT_FAILURE.MISSING_URL_COLUMN)`.
    5. Per row:
       - an empty url gives `{ label: "Row N", error: "Row N has no url" }`;
       - otherwise `linkItem("CSV", { url, title, tags, notes, folders: [folderPath(folder.split("/"))], createdAt })`.
  - Tags split on `,`, else `|`, else `;`, with `#` stripped, through `cleanTags`.
- **`import/sources.ts`:** `case "csv": return parseGenericCsv(text)` and `case "links": return parseOneTabText(text, "Text file")`.
- **`import/onetab.ts`:** `parseOneTabText(text, source = "OneTab")`, so the `notAnExport` message names the chosen source.
- **`apps/files-worker/src/archives/importSource.ts`:** map an error whose message equals `missing_url_column` to that failure class, instead of `invalid_import_source`.

## Web

- **`ImportPanel.tsx`:**
  - Filter out `hidden` sources from the `Select`.
  - Order the list: Browser bookmarks, CSV file, Text file of links, then the named services as today, then Teak archive.
  - A running or finished `onetab` job still shows its title "OneTab" in the status line (line 459).
- **Hint under the CSV choice:** the title and hint above, plus an inline "Example" disclosure (a shadcn `Collapsible`) showing:

  ```
  url,title,tags,folder,note,created
  https://example.com,Example,"design, type",Work/Design,A note,2024-05-01
  ```

  Collapsed by default.
- No other UI change. Progress, the report and duplicates work as for every import.

## API / MCP / SDK / CLI

- None.

## Docs

- **`(data)/import.mdx`:**
  - the description and intro add "a CSV file or a text file of links";
  - two rows in the Sources table, with the header names and aliases;
  - an example CSV;
  - the OneTab row points to "Text file of links".
- The month's changelog: "Import links from any CSV".

## UI states

- **Picker:** the new entries with hints. Choosing CSV filters the file chooser to `.csv`.
- **Missing url column:** the import fails right after indexing, with the message above.
- **Partial success:** "Imported 940 of 1,000 · 60 skipped", with the existing report download.
- **Empty CSV:** "This doesn't look like a CSV export…" (from `notAnExport`).
- **Huge file** (over 20 MB, or over 10,000 rows): the existing size and count messages.

## Scenario seed packs

- None seeded. The fixtures are files in the test folder: `packages/convex/__tests__/import/fixtures/` and the e2e fixtures:
  - `minimal.csv` (url only);
  - `full.csv` (every column);
  - `aliases.csv` (Link, Name, Labels, Collection, Description, Date Added);
  - `tags-pipe.csv`;
  - `no-url.csv`;
  - `quoted-newlines.csv`;
  - `bom-crlf.csv`;
  - `10001-rows.csv`;
  - `unsafe-urls.csv` (`javascript:`, `data:`);
  - `variants.csv` (the same link with `utm_` and `www`);
  - `links.txt` (with titles, without titles, and blank lines).

## Break-it checklist

- Upload each fixture.
- A CSV with two `url` columns: the first wins.
- Headers with odd spacing or case ("  URL ", "Date_Added").
- A 20 MB CSV.
- A semicolon-delimited CSV (European Excel): fails with the missing url column message (see open decision).
- Cancel mid-import, then retry.
- Start a second import while one runs (`IMPORT_ACTIVE`).
- A free account at 195 cards importing 50.
- An `onetab` job left from before the deploy: it resumes and finishes.

## Tests

- `packages/convex/__tests__/import/genericCsv.test.ts`: every fixture, including the alias table (`test.each`), tag splitting, date formats, and the missing-url-column error.
- `packages/convex/__tests__/import/onetab.test.ts`: the source label.
- `packages/convex/__tests__/shared/importSources.test.ts`: hidden sources are excluded from the visible list, and the new failure is described.
- `apps/files-worker/src/archives/importSource.test.ts`: the failure-class mapping.
- `apps/web/src/components/settings/__tests__/ImportPanel.test.tsx`: the picker order and that OneTab is hidden.
- e2e: `packages/tests/src/web/import-csv.e2e.ts` (new). Import `full.csv` and see cards with their tags and folders; import `no-url.csv` and see the error.

## Proof before the PR

- **Video 1:** import `aliases.csv`, then open a card and show its title, tags, folder, note and date.
- **Video 2:** `no-url.csv`, then `variants.csv`, and the report with skipped duplicates.
- **Screenshots:** the picker, the CSV hint with Example open, the error and the report, in light and dark at 390px and 1440px.

## Release gate

1. Run the narrow tests, the repo checks and the e2e spec.
2. Run the break-it pass with the fixtures, and fix and add regression tests until it is clean.
3. Send the proof bundle to the owner.
4. Merge. Deploy the Files Worker first, then Convex and web. Smoke-test importing `minimal.csv` on production.

## Risks And Open Questions

- **Open decision (default: comma-separated only).** Semicolon CSVs from European spreadsheet locales would fail with a clear message. Auto-detecting `;` from the header line is a small addition if the owner wants it.
- **Open decision (default: no favorite or archived columns).** The owner listed six fields. Adding `favorite` and `archived` (true/1/yes) would be easy and matches the existing importers.
- **Open decision (default: a CSV with no header is refused).** A headerless single column of URLs would be better served by "Text file of links".
- **The `onetab` mode** can be removed from the validators only after its jobs age out. Record it in `.agents/sunset.md`.
