## Goal

Import from Pocket, Instapaper, Linkwarden, mymind, Readwise, Omnivore and OneTab, and turn folders in Netscape bookmark files and Raindrop exports into Teak folders instead of tags. Phase 12 of the [roadmap](2026-10-12-roadmap-00-roadmap.md).

## Depends on

- [Phase 5](2026-10-12-roadmap-05-folders.md) (folders). Shares import folder plumbing with [Phase 11](2026-10-12-roadmap-11-export-v2.md).

## Success Criteria

- Settings → Import offers each new source with a one-line hint of which file to upload; each produces cards with URL, title, tags, notes or highlights where the source has them, favorite and archive state where it has them, and the original saved date.
- Netscape and Raindrop folders become Teak folders; nested paths are flattened as "A / B".
- Re-importing the same file creates no duplicates (existing URL dedupe) and reuses folders created by the same job.
- Malformed files fail with a clear message and no partial import.

## Context And Current Facts

- Mode wiring today, all `"bookmarks" | "archive" | "raindrop"`:
  - `packages/convex/import/constants.ts` (`ImportMode` type, `MAX_BOOKMARK_BYTES` and `MAX_RAINDROP_BYTES` = 20 MiB, `MAX_IMPORT_CARDS = 10_000`)
  - `packages/convex/schema.ts importModeValidator`
  - `packages/files-protocol/src/index.ts:258` (`mode` on the index params)
  - `apps/files-worker/src/importSource.ts` (mode allow-list at about line 38, parser choice at about line 122)
  - `packages/ui/src/components/settings/ImportPanel.tsx` (`ImportMode`, per-mode copy, `MODE_ORDER`, file input refs)
  - `import/validate.ts assertImportCardCount` (per-mode error text)
- Parsing runs in the Files Worker, which imports `parseBookmarksHtml` and `parseRaindropCsv` from `@teak/convex/import/*` and reads the whole source with `object.text()`. New parsers therefore ship in the worker, which deploys first.
- `import/raindrop.ts` already exports `parseCsvRows` (RFC 4180, quoted fields, column and row caps with Raindrop-specific error text). Extract it to `import/csv.ts` with neutral errors.
- `import/bookmarks.ts parseBookmarksHtml` returns `ParsedBookmarkItem { folders: string[] … }` and currently copies folder names into `tags`; `raindrop.ts collectTags` splits the `folder` column on `/` into tags.
- `dataImport.ts` dedupes by URL against existing cards (`existingUrl`, `by_user_url_deleted`) and within a job (`importJobItems.by_jobId_and_url`). `importJobItems` has no `folders` field today.
- There is no public import endpoint, so this phase has no API, MCP or CLI surface.

## Constraints And Non-goals

- Files Worker deploys before Convex and web; add any new worker capability to `scripts/check-files-readiness.ts`.
- Pure parsers in `packages/convex/import/`, one per source, each returning `ParsedBookmarkItem[]` (extended with `isFavorited?`, `isArchived?`, `notes?`, `createdAt?`, `folders?`).
- Free cap applies; imports past 200 cards stop as today.
- Folder get-or-create is per job and uses Phase 5's `nameKey`, respecting the 500-folder and 50-per-card caps (overflow folders are skipped and reported).
- No HTML scraping of the source services; uploaded files only.

## Backend

- `import/csv.ts`: shared CSV reader extracted from `raindrop.ts`.
- New parsers: `import/pocket.ts`, `instapaper.ts`, `linkwarden.ts`, `mymind.ts`, `readwise.ts`, `omnivore.ts`, `onetab.ts`. Confirm each format against a real export before writing the parser; record the sample's shape in the fixture.
- `bookmarks.ts` and `raindrop.ts`: emit `folders` as flattened paths ("A / B"); stop copying folder names into tags.
- Wire modes through `import/constants.ts`, `schema.ts importModeValidator`, `files-protocol`, `apps/files-worker/src/importSource.ts`, and `validate.ts assertImportCardCount`.
- `importJobItems.folders?: string[]` (plus `isArchived?` if Phase 11 has not added it).
- `dataImport.ts`: per job, a `folderName → folderId` map persisted on the job or looked up by `nameKey`; set `folderIds` on created cards.

## Web

- `settings/ImportPanel.tsx`: a source picker (Select) listing all sources; each shows one line of guidance ("Upload the CSV from Pocket's export page") and accepts the right extension.

## API / MCP / SDK / CLI

- None (imports are web-only today).

## Docs

- `content/docs/(data)/import.mdx`: one short section per source, and folders from bookmarks and Raindrop.
- Ship-month changelog: "Import from more apps".

## UI states

- Empty: picker defaults to "Browser bookmarks".
- Loading: existing import progress (parsing, importing counts).
- One item / many items: 10,000-item files stay within caps; per-source caps share `MAX_IMPORT_CARDS`.
- Very long names: long folder paths ("A / B / C …") truncate in the sidebar after import.
- Error: "This doesn't look like a Pocket export." per source; partial failures listed in the existing failure samples.
- Rate-limited: existing import concurrency (one active import).
- UI bar: one primary action (Choose file); source guidance in muted text.

## Scenario seed packs

- Import fixtures (files, not seeded cards): one valid and one malformed file per source; a Netscape file with 6-level nesting and 600 folders; a Raindrop CSV with nested folders; duplicate URLs across files; a 20 MiB file; BOMs, CRLF and unicode.

## Break-it checklist

- UI: pick the wrong source for a file; cancel mid-import; reload during parsing; import the same file twice; 390px picker.
- Backend: fuzz each parser with truncated files, wrong delimiters, extra columns, missing URL column, `javascript:` URLs, unicode hosts; folder cap overflow (501st folder skipped and reported); card in more than 50 folders; free cap reached mid-import; dedupe against trashed and archived cards.

## Tests

- `packages/convex/__tests__/import/<source>.test.ts` for each new parser: fixture parses to the expected items; malformed fixture throws.
- `packages/convex/__tests__/import/csv.test.ts`: shared reader table tests.
- `packages/convex/__tests__/import/bookmarks.test.ts` and `raindrop.test.ts`: folders flattened, no longer copied into tags.
- `packages/convex/__tests__/dataImport.test.ts`: folder get-or-create per job, reuse across items, dedupe by URL, caps.
- `apps/files-worker/src/importSource.test.ts`: every mode accepted and routed to its parser.

## Proof before the PR

- Video: import a Pocket CSV and a nested Netscape file, watch progress, open the created folders.
- Screenshots: source picker, guidance per source, progress, error for a wrong file, folders in the sidebar after import; light and dark; 390px and 1440px.

## Release gate

1. Narrow tests above, then the repo checks and `apps/files-worker`, `packages/files-protocol` tests.
2. Run each fixture through the dev stack, then the break-it pass; fix and add regression tests.
3. Proof bundle as above.
4. PR, green CI, merge. Deploy the Files Worker first, confirm readiness, then Convex and web. No backfill. Smoke-test production with one small file per new source in a test account.

## Risks And Open Questions

- Some services export ZIPs (Omnivore) or JSON larger than 20 MiB; confirm whether they need the archive path or a higher byte cap.
- Stopping folder-as-tag changes behavior for people who relied on it; the changelog states it.
