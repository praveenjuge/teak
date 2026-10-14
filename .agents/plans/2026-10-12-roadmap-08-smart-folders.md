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

## As built

- **Grammar and merge:** a smart folder stores its search the canonical way (`parseSearchQuery(...).canonical`). `combineSearchQueries(scope, typed)` in `shared/search/qualifiers.ts` joins it with what is typed so both must match: `type:` and `site:` intersect (each matches any of its values within one search), tags, folders, phrases, words and `is:` add up, and a contradiction is `null` (an empty page). The same function serves the grid, the API and local filtering. `renameFolderInSearchQuery` rewrites `folder:` when a manual folder is renamed, so smart folders follow it.
- **Backend:** `folder/folders.ts` `createFolderForUser`/`updateFolderForUser` take `kind`/`query`; `normalizeSmartFolderQuery` refuses an empty search, one over `MAX_SMART_FOLDER_QUERY_LENGTH` (500, as stored), and a `folder:` that is not one of the user's manual folders ("No folder named …", or "can't use another smart folder"). Manual folders refuse a `query`. No schema change: `kind` and `query` were already on `folders`.
- **Evaluation:** `searchPlanner.expandFolderSearch` turns a smart folder view into its combined search with no folder filter, then the Phase 7 planner runs it, so a card saved later appears live. `resolveFolderNames` never resolves a smart folder (no card is in one), so `folder:` naming one, or a deleted folder, matches nothing. **Deviation:** `searchCardsPaginated` also takes `folderQuery`, the search the client last read for the folder. Without it, editing a smart folder changed the read behind pages the grid already held; their cursors failed with `InvalidCursor` and the grid crashed ("Too many re-renders"). With it, an edit starts a new paginated query and every cursor belongs to the search that issued it. Any search the user could type is fine there.
- **Membership:** `addCardsToFolder`, `setCardFolders`, bulk folder actions and the API's card `folderIds` refuse a smart folder with `SMART_FOLDER` (409 in the API). A move out of a smart folder's view adds to the target, since nothing is in the smart folder. **Deviation:** deletion keeps the normal Undo window instead of deleting at once; the batch finds no rows and removes the folder.
- **API/MCP/SDK/CLI:** `POST /v1/folders` takes `kind`/`query` (a `query` needs `kind: "smart"`), `PATCH` takes `query`; folders serialize `kind`, `query` (null for manual) and `cardCount` (null for smart). `GET /v1/cards?folder=<smart>` rewrites the request to the combined `q` and drops the folder. MCP create/update accept `kind`/`query`; the SDK types follow; `teak folders create --query` and `rename --query`, and `teak folders` shows `-` and `smart: <search>`.
- **Web:** **Deviation:** the header has no overflow menu, so **Save as smart folder…** sits under the sort options in the sort menu (its trigger reads "Sort and save search" while there is something to save). `buildSmartFolderQuery` saves the chips and words, sidebar types and tag, the Favorites or Archive view, and a manual folder as `folder:` or a smart folder's own search; colors, styles and dates are not part of the grammar, so the dialog says they aren't saved. `FolderNameDialog` handles both kinds: a two-line search field (Enter saves), a suggested name (`suggestSmartFolderName`), server errors routed to the field they concern, and an empty or half-typed search only disables Save. The sidebar uses `FolderSearch` and no count, with **Edit search…**; the folder view shows `SmartFolderQuery` chips (two lines, then clipped; a missing folder reads "No folder named …"), **Edit search**, and "No cards match this smart folder." Pickers, the card's Folders checklist and `folder:` suggestions list only manual folders; a smart folder's view offers no Remove from folder.
- **Error state:** the grammar reads any text, so a stored search never fails to parse; the case left is a `folder:` whose folder was deleted, shown as a "No folder named …" chip over the empty state.
- **Seed pack:** `smart-folders` (nothing, the whole pack, one card, `folder:"Reading list" is:fav`, design links, an emoji and an RTL search, and a search at the 500-character limit).
- **Tests:** `folders.test.ts` "smart folders" (validation, canonical storage, live and typed merge, rename and delete of a referenced folder, membership refusals, a stale page cursor), `__tests__/shared/search/qualifiers.test.ts` (combine and rename), `__tests__/publicApiHttpFolders.test.ts`, `lib/__tests__/folders.test.ts` (save query and name), the controller's smart-folder test, CLI command tests, `devSeed.test.ts`, and a `folders.e2e.ts` spec: save from a search, a card saved later appears live, the picker leaves the smart folder out, Edit search to an empty state.
- **Break-it fixes:** the `InvalidCursor` crash above; "Add a search for the smart folder" flashed while `folder:` was still being typed (now Save is just disabled); the long search overflowed a one-line field.
