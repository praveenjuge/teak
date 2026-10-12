## Goal

Let people save any search as a smart folder: a sidebar entry whose cards are whatever currently match its query, evaluated live through the Phase 7 planner. Phase 8 of the [roadmap](2026-10-12-roadmap-00-roadmap.md).

## Depends on

- [Phase 7](2026-10-12-roadmap-07-search-qualifiers.md) (`parseSearchQuery`, `card/searchPlanner.ts`); [Phase 5](2026-10-12-roadmap-05-folders.md) (`folders` table with `kind` and `query`).

## Success Criteria

- "Save search as smart folder" in the search header creates a folder with `kind: "smart"` and the canonical query; it appears in the sidebar with a distinct icon.
- Opening it shows the live results; a card saved later that matches the query appears without a reload.
- Smart folders are never drop targets: bulk "Add to folder" and the Folders… checklist list only manual folders.
- API accepts `kind` and `query` on create and update; listing a smart folder's cards via `?folder=` evaluates the query.

## Context And Current Facts

- Phase 5's `folders` schema already carries `kind: "manual" | "smart"` and `query?`, so this phase adds no table.
- `folderCards` rows exist only for manual folders; smart folders have no stored membership and no reliable `activeCardCount`.
- Phase 7's planner turns a parsed query into one indexed driver plus a `resultFilter`; `folder:` is one of its drivers, which makes a smart query that references another smart folder possible.
- The canonical query string comes from `parseSearchQuery(...).canonical` and is what the URL already carries (`?q=`).
- The folder cap (500) from Phase 5 counts manual and smart folders together.

## Constraints And Non-goals

- No schema change beyond validating `query` (max length, parses cleanly) when `kind` is `"smart"`.
- Evaluation is live per request through the planner; no materialized membership, no background job.
- A smart folder's `folder:` qualifier may reference only manual folders (no recursion).
- Public API order: extend `publicApiFolders.ts` validation → `publicApiHttpFolders.ts` → no new route → `publicApiOpenApi.ts` (`kind`, `query`) → `mcp/tools.ts` (`teak_v1_create_folder` / `update` accept them) → `client/sdk.ts` → CLI flags.

## Backend

- `folders/folders.ts`: `createFolder` and `updateFolder` accept `kind: "smart"` with `query`; reject an empty or unparsable query, and `folder:` pointing at a smart folder.
- `searchCardsPaginated({ folderId })`: for a smart folder, parse its stored query, merge it with any extra query the user typed, and run the planner.
- `folders/membership.ts`: refuse membership writes to smart folders with a clear error.
- `workflows/folderDeletion.ts`: a smart folder deletes immediately (no rows to page).

## Web

- `search/CardsSearchHeader.tsx`: a secondary "Save as smart folder" item in the header's overflow menu when the query is non-empty; opens a name dialog prefilled from the query.
- Sidebar: smart folders show a `Sparkles` (or `ListFilter`) icon and no count; menu adds "Edit query".
- Folder view header shows the query as read-only chips for smart folders.

## API / MCP / SDK / CLI

- `POST /v1/folders { name, kind: "smart", query }`, `PATCH /v1/folders/:id { query }`; adding cards to a smart folder returns 409.
- MCP and SDK accept `kind`/`query`; CLI `teak folders create "Design links" --query 'tag:design type:link'`.

## Docs

- `features.mdx` "Folders": smart folders paragraph with an example.
- `(developers)/api.mdx`, `mcp.mdx`, `(apps)/cli.mdx`.
- Ship-month changelog.

## UI states

- Empty: a smart folder that matches nothing shows "No cards match this smart folder." with "Edit query".
- Loading: skeleton grid; sidebar never waits on evaluation (no counts).
- One item / many items: a query that matches everything pages like All.
- Very long names: the query chips in the header wrap to two lines, then truncate.
- Error: a stored query that no longer parses (grammar change) shows the raw query and "Edit query".
- Rate-limited: not applicable.
- UI bar: the save action is a menu item, not a new button; dialog has one primary action.

## Scenario seed packs

- `smart-folders`: queries that match nothing, everything, one card; a query using `folder:` on a manual folder; a 500-character query; emoji and RTL in names and queries.

## Break-it checklist

- UI: save the same search twice fast; edit a query to something invalid; drag or bulk-add into a smart folder (blocked); open a smart folder in two tabs while saving a matching card in a third; 390px header.
- Backend: smart query referencing another smart folder (rejected); referencing a deleted manual folder (empty result); `query` over the max length; another user's folder ID; membership write to a smart folder (409).

## Tests

- `packages/convex/folders.test.ts`: a newly saved matching card appears in the smart folder; a non-matching edit drops it; membership writes refused.
- `packages/convex/__tests__/folders/smartFolders.test.ts`: validation (empty, unparsable, recursive), merge of stored and typed queries.
- `packages/convex/__tests__/publicApiHttpFolders.test.ts`: create/update with `kind`/`query`; 409 on add cards.
- `packages/tests/src/web/folders.e2e.ts`: extend with save-as-smart-folder and a live match.

## Proof before the PR

- Video: search `tag:design type:link`, save as smart folder, add a matching link elsewhere and watch it appear, edit the query.
- Screenshots: save dialog, sidebar icon, empty and populated smart folder, invalid-query state; light and dark; 390px and 1440px.
- Captured API create and listing, CLI output.

## Release gate

1. Narrow tests above, then the repo checks and `folders.e2e.ts`, `03-api.e2e.ts`.
2. Seed `smart-folders`, run the break-it pass, fix and add regression tests.
3. Proof bundle as above.
4. PR, green CI, merge, deploy Convex then web. No backfill. Smoke-test production: create, open and delete a smart folder.

## Risks And Open Questions

- Live evaluation of a broad query costs the same as the equivalent search; the planner's scan budgets bound it.
