## Goal

Make Teak exports complete and portable: `cards.json` gains AI fields, titles, archive state and folder names (schema v2), and the ZIP adds a browser-importable bookmarks HTML and a spreadsheet-safe CSV. Teak's own archive importer reads v1 and v2. Phase 11 of the [roadmap](2026-10-12-roadmap-00-roadmap.md).

## Depends on

- [Phase 5](2026-10-12-roadmap-05-folders.md) (folder names). Archive state from [Phase 3](2026-10-12-roadmap-03-archive-bulk-actions.md).

## Success Criteria

- A new export's `manifest.json` reports `schemaVersion: 2`; each card in `cards.json` includes `aiTags`, `aiSummary`, `metadataTitle`, `isArchived` and `folders` (names).
- The ZIP contains `bookmarks.html` (Netscape format, folders as `<H3>` sections, unfiled links at the top) that Chrome, Firefox and Safari import, and `cards.csv` (RFC 4180) that opens safely in Excel, Numbers and Google Sheets.
- Re-importing a v2 archive into an empty account recreates folders, archive state and titles; v1 archives still import unchanged.

## Context And Current Facts

- `SCHEMA_VERSION = 1` and `EXPORT_VERSION = 1` live in `packages/convex/export/constants.ts`; `buildManifest` (`export/serialize.ts`) writes both into `manifest.json`. `cards.json` is just `{ cards: [...] }`.
- `serializeCard` (`export/serialize.ts:141`) emits `id, type, content, tags, isFavorited, createdAt, updatedAt` (dual timestamps), plus `url`, `notes`, `colors` and `file` when present. Trashed cards are excluded (`isActiveCard`).
- `export/runExport.ts` builds a manifest of inline entries (`path` + `contentBase64`) and storage keys and hands it to the Files Worker's `build-export` op, which streams the ZIP with client-zip. New `bookmarks.html` and `cards.csv` entries fit that shape without a worker change.
- Import side: the Files Worker (`apps/files-worker/src/importSource.ts:76`) rejects an archive whose manifest `exportVersion` is not 1 and does not read `schemaVersion`. So bumping only `SCHEMA_VERSION` keeps old workers able to read v2 archives (new fields ignored), but reading folders, archive state and titles needs the new worker first. Card JSON is streamed by `apps/files-worker/src/importJson.ts` (`$.cards.*`).
- `dataImport.ts importedBookmarkTitle` returns no title for `archive` mode, so archive imports drop `metadataTitle` today. `import/validate.ts validateImportCard` caps tags at 50 of 64 characters.
- Limits: `MAX_EXPORT_CARDS = 10_000`, `MAX_EXPORT_BYTES = 5 GB`.

## Constraints And Non-goals

- Files Worker deploys before Convex: the archive importer change (folders, archive, titles) ships in the worker first.
- `EXPORT_VERSION` stays 1 so older workers and third-party readers keep accepting new archives; only `SCHEMA_VERSION` moves to 2.
- Pure builders (`buildBookmarksHtml`, `buildCardsCsv`) with no Convex context, so they are fuzz-testable.
- CSV formula-injection guard: prefix a cell starting with `=`, `+`, `-`, `@`, tab or carriage return with `'`.
- Folder creation on import shares plumbing with [Phase 12](2026-10-12-roadmap-12-importers.md) (`importJobItems.folders`, get-or-create per job in `dataImport.ts`); whichever phase lands first adds it.
- Imports still respect the 200-card free cap; archived cards count.
- No AI fields are imported back (AI regenerates).

## Backend

- `export/constants.ts`: `SCHEMA_VERSION = 2`; entry names `BOOKMARKS_ENTRY_NAME = "bookmarks.html"`, `CSV_ENTRY_NAME = "cards.csv"`.
- `export/serialize.ts serializeCard(card, { includeFile, folderNames })`: add `aiTags`, `aiSummary`, `metadataTitle`, `isArchived`, `folders`.
- `export/bookmarks.ts buildBookmarksHtml(cards)`: links only, escaped titles and URLs, `ADD_DATE` from `createdAt`, `TAGS` attribute, folders as `<H3>`; a card in several folders appears in each.
- `export/csv.ts buildCardsCsv(cards)`: columns `id, type, title, url, content, notes, tags, aiTags, aiSummary, folders, isFavorited, isArchived, createdAt`; RFC 4180 quoting; injection guard; BOM for Excel.
- `export/runExport.ts`: load folder names once per job; add both entries.
- Import: `importJobItems` gains `folders?`, `isArchived?`, `metadataTitle?`; `import/validate.ts` accepts them; `dataImport.ts` sets archive and title for archive mode and get-or-creates folders per job.

## Web

- `settings/ExportPanel.tsx`: describe what is inside the ZIP (cards.json, files, bookmarks.html, cards.csv). No new controls.

## API / MCP / SDK / CLI

- No new endpoints; `/v1/exports` produces v2 archives. Note the schema bump in OpenAPI's export description.

## Docs

- `content/docs/(data)/export.mdx`: v2 fields, `bookmarks.html`, `cards.csv`.
- `content/docs/(data)/import.mdx`: v2 archives restore folders, archive and titles.
- Ship-month changelog: "Richer exports".

## UI states

- Empty: exporting an empty library still produces a valid ZIP with headers-only CSV and an empty bookmarks file.
- Loading: existing export progress UI (`snapshotting`, `archiving`).
- One item / many items: 10,000 cards stay inside existing caps.
- Very long names: 300-character titles and folder names survive in all three formats.
- Error: existing export failure classes; no new ones.
- Rate-limited: existing weekly export quota.
- UI bar: copy-only change in the panel.

## Scenario seed packs

- `export-ugly`: titles and folder names with quotes, commas, newlines, `<script>`, `=HYPERLINK(...)`, emoji, RTL and CJK; a card in 50 folders; archived and favorite cards; cards with and without AI fields.

## Break-it checklist

- UI: start an export, reload, download; open `cards.csv` in a spreadsheet (no formulas run); import `bookmarks.html` into Chrome and Firefox.
- Backend: CSV fuzz (random unicode, quotes, CR/LF, leading `=+-@`); bookmarks HTML escaping fuzz; v1 archive into the new worker; v2 archive into the old worker (imports, ignores new fields); v2 round-trip into an empty account; v2 import past the free cap.

## Tests

- `packages/convex/__tests__/export/serialize.test.ts`: v2 fields present; folder names; trashed excluded.
- `packages/convex/__tests__/export/bookmarks.test.ts` and `csv.test.ts`: escaping tables, injection guard, RFC 4180 round-trip via `parseCsvRows` (`import/raindrop.ts`).
- `packages/convex/__tests__/import/validate.test.ts`: v2 fields accepted and bounded.
- `packages/convex/__tests__/dataImport.test.ts`: archive mode sets archive, title and folders; folder dedupe per job.
- `apps/files-worker/src/importSource.test.ts`: v1 and v2 archives parse.

## Proof before the PR

- Video: export, download, open the ZIP, import `bookmarks.html` into a browser, open `cards.csv`, re-import the ZIP into a fresh dev account and see folders and archive restored.
- Screenshots: ZIP listing, spreadsheet view of `cards.csv`, browser bookmarks after import, Settings export panel; light and dark; 390px and 1440px.

## Release gate

1. Narrow tests above, then the repo checks, `apps/files-worker` tests and `packages/tests/src/web/composer-and-settings.e2e.ts` (export flow if covered).
2. Seed `export-ugly`, run the break-it pass, fix and add regression tests.
3. Proof bundle as above.
4. PR, green CI, merge. Deploy the Files Worker first (`bun run --cwd apps/files-worker deploy`), confirm `scripts/check-files-readiness.ts --prod`, then Convex and web. No backfill. Smoke-test production: export a small account and re-import into a test account.

## Risks And Open Questions

- Folder plumbing overlaps with Phase 12; keep the shared parts in this PR if it lands first and note it in Phase 12's PR.
