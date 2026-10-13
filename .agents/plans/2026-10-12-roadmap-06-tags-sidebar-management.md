## Goal

Show every tag with its card count in the sidebar, filter by clicking one, and rename, merge or delete a tag across the whole library (user and AI tags, active and trashed cards) as a tracked background operation. Phase 6 of the [roadmap](2026-10-12-roadmap-00-roadmap.md).

## Depends on

- [Phase 4](2026-10-12-roadmap-04-sidebar-app-shell.md) (sidebar Tags slot).

## Success Criteria

- The sidebar Tags section lists tags with counts from a cached snapshot that refreshes within about 15 seconds of tag changes, without a reactive scan of thousands of rows on every render.
- Clicking a tag filters the library to that tag; right-click offers Rename, Merge into…, Delete.
- Rename, merge and delete rewrite `tags` and `aiTags` on every matching card case-insensitively, including trashed and archived cards, report progress, and allow only one active operation per user.
- A concurrent edit to a card during an operation is preserved (the operation only changes the target tag).
- `POST /v1/tags/rename|merge|delete` return 202 with an operation ID; `GET /v1/tags/operations/:id` reports progress; MCP, SDK and CLI match.

## Context And Current Facts

- `listTagsForUser` (`publicApi.ts:830`) walks `cardSearchTags.by_user_tag_deleted_created` and reads up to `MAX_TAG_ROWS_READ = 8000` rows per call, returning `isComplete: false` past that. Making this a reactive sidebar query would rerun that scan on every tag change, hence the debounced snapshot.
- Tags in `cardSearchTags` are normalized by `normalizeCardSearchTag` (trim + lowercase) and merged from `tags` and `aiTags`; cards keep their original casing.
- The tag sync chain (`restartCardSearchTagSync` → `syncCardSearchTagsBatchHandler` in `card/searchDocumentHelpers.ts`) is generation-fenced, batches 32 tags (`CARD_SEARCH_TAG_SYNC_BATCH_SIZE`), and marks `cardSearchTagSyncStates.pending: false` when done (about line 445). That completion is where the user's snapshot is marked dirty.
- Per-card tag editing already exists in `packages/ui/src/components/modals/TagManagementModal.tsx`; the new library-wide dialog needs a distinct name (`TagManagerDialog.tsx`).
- CLI already has `teak tags` / `teak tags list`, `teak tags add <id> <tags...>` and `teak tags rm <id> <tags...>` (remove tags from one card). The roadmap's `teak tags rm` for a global delete would clash, so the global delete is `teak tags delete <tag>`.
- `GET /v1/tags` is an exact-path route in `http.ts`; `/v1/tags/rename` etc. need exact routes plus a `/v1/tags/operations/` prefix route and OPTIONS entries.
- Import validation caps a card at 50 tags of 64 characters (`import/validate.ts`); rename and merge enforce the same limits.

## Constraints And Non-goals

- Every card write goes through `patchCardWithSearchSync` so search docs, tag rows and folder rows follow.
- New tables (`userTagSummaries`, `tagOperations`) are per user: add them to `accountDeletionData.ts ancillaryPage`. They hold no card IDs or R2 keys, so card hard delete needs nothing.
- Append-only workflow: `workflows/tagOperations.ts` is a new workflow, not a step in `cardProcessing.ts`.
- No "delete unused tags" (dropped). No AI tag preferences (dropped).
- Public API order: `publicApiTags.ts` internal functions → handlers in `publicApiHttpCards.ts` (beside `handleTagsRequest`) → `executePublicApiOperation` → `http.ts` routes and OPTIONS → `publicApiOpenApi.ts` → `mcp/tools.ts` → `client/sdk.ts` → CLI.

## Backend

- `userTagSummaries { userId, items: [{ name, count }], isComplete, dirtyAt?, computedAt }`: `markTagSummaryDirty(userId)` is called when a tag sync completes; it schedules `recomputeTagSummary` about 15 seconds later only if none is pending. The sidebar query reads the snapshot row.
- `tagOperations { userId, kind: "rename" | "merge" | "delete", from, to?, status: "running" | "completed" | "failed", processed, changed, cursor?, createdAt, updatedAt }` with `by_userId_and_status`.
- `workflows/tagOperations.ts`: pages `cardSearchTags.by_user_tag_deleted_created` for the source tag over active and trashed rows; for each card, rewrite `tags` and `aiTags` case-insensitively (dedupe, keep the target's casing) via `patchCardWithSearchSync`; record progress; refuse to start a second running op.
- `tags/tagOperations.ts`: `startTagOperation` (session and internal), `getTagOperation`, `listTagSummary`.

## Web

- `AppSidebar` Tags section: top tags by count, "Show all" expands; click filters the library (adds the tag filter, or `tag:` in Phase 7); context menu Rename, Merge into…, Delete.
- `packages/ui/src/components/modals/TagManagerDialog.tsx`: rename (text input), merge (Command list of tags), delete (confirm with card count); starts the op and shows a progress toast that updates until done.

## API / MCP / SDK / CLI

- `POST /v1/tags/rename { from, to }`, `/v1/tags/merge { from, into }`, `/v1/tags/delete { tag }` → 202 `{ operationId }`; 409 if one is running; `GET /v1/tags/operations/:id`.
- MCP `teak_v1_rename_tag`, `teak_v1_merge_tags`, `teak_v1_delete_tag`, `teak_v1_get_tag_operation`. SDK `tags.rename | merge | delete | operation`. CLI `teak tags rename <from> <to>`, `teak tags merge <from> <into>`, `teak tags delete <tag>` (with `--wait`).

## Docs

- `features.mdx` "Tags and filters": the sidebar list and library-wide rename, merge and delete.
- `(developers)/api.mdx`, `mcp.mdx`, `(apps)/cli.mdx`.
- Ship-month changelog: "Manage tags across your library".

## UI states

- Empty: "No tags yet." under the section header, no action.
- Loading: three skeleton rows; snapshot `isComplete: false` shows "Showing the first 8,000 tagged cards" in a muted line.
- One item / many items: 2,000 tags scroll inside the section; "Show all" reveals the rest.
- Very long names: 64-character and RTL tags truncate with a tooltip.
- Error: rename to an existing tag suggests Merge; a failed op shows "Couldn't finish renaming. 120 of 300 cards changed." with Retry.
- Rate-limited: a second op while one runs shows "Another tag change is still running."
- UI bar: counts in muted tabular numbers; progress in one toast, not a modal; undo is not offered for merges (confirm instead).

## Scenario seed packs

- `tags-2000`: 2,000 tags over 1,000 cards; `tags-case`: `Design`, `design`, `DESIGN` across user and AI tags; tags on trashed and archived cards; emoji, RTL and CJK tags.

## Break-it checklist

- UI: rename twice fast; merge a tag into itself (blocked); delete while filtering by that tag; reload mid-operation (progress resumes from the row); two tabs starting ops (one refused); 390px menu.
- Backend: case variants collapse to one; trashed and archived cards included; edit a card's notes during the op (kept); add a tag to a card mid-op; another user's operation ID (404); account deletion mid-op; snapshot recompute storms (debounce holds).

## Tests

- `packages/convex/tagOperations.test.ts` (convex-test, add to `vitest.config.ts`): case variants, trashed included, concurrent edit preserved, one active op per user, merge dedupes.
- `packages/convex/__tests__/tags/tagSummary.test.ts`: dirty marks debounce to one recompute; counts exclude trashed.
- `packages/convex/__tests__/publicApiHttpCards.test.ts` (or a new `publicApiHttpTags.test.ts`): 202, 409, operation polling, bad input.
- `apps/cli/src/commands.test.ts`: `teak tags rename|merge|delete` output and exit codes.

## Proof before the PR

- Video: sidebar tags, filter by one, rename `Design` to `design-systems`, merge two tags, delete a tag, watch progress.
- Screenshots: tags section empty, 10 and 2,000 tags; TagManagerDialog per mode; progress and error toasts; light and dark; 390px and 1440px.
- Captured `POST /v1/tags/rename`, polling output, `teak tags rename --wait`.

## Release gate

1. Narrow tests above, then the repo checks and `02-web-journey.e2e.ts`, `03-api.e2e.ts`, `04-cli.e2e.ts`.
2. Seed the tag packs, run the break-it pass, fix and add regression tests.
3. Proof bundle as above.
4. PR, green CI, merge, deploy Convex then web. No backfill: snapshots build on first read. Smoke-test production: tags list, a rename on a test tag, then rename it back.

## Risks And Open Questions

- Renaming an AI tag to a user tag: proposed behavior is to keep the field it was in (`aiTags` stays AI).
- A very large vault (above 8,000 tag rows) needs the snapshot recompute to page across several mutations.

## As built

- **Modules:** the functions live in `packages/convex/tag/` (`tagSummary.ts`, `tagOperations.ts`), re-exported by the top-level `tags.ts` as `api.tags.*`, like `folders.ts` (a `tags.ts` file beside a `tags/` folder would collide). Limits, error copy and the rewrite rule (`rewriteTagList`) live in `shared/tags.ts`, so the server, API and apps agree.
- **Snapshot:** `userTagSummaries` holds the counts (active cards only, like `GET /v1/tags`; at most 3,000 tags, most-used first). A pending recompute is a separate tiny `tagSummaryRefreshes` row, so tag syncs never read the large snapshot: the first tag sync to finish after a change inserts it and schedules `recomputeTagSummary` 15 seconds later; the rest see it and do nothing. The recompute is an action whose reads are queries (no write conflicts with card writes), paging by rows and by distinct tags, even part way through one tag. A marker older than five minutes is treated as lost and rescheduled. The first snapshot is built when the Tags page asks for it (`requestTagSummary`), so there is no backfill.
- **Operations:** a scheduled batch mutation (`runTagOperationBatch`, 25 cards per run) rather than a durable workflow, matching folder deletion. It pages the tag index with a stored cursor over every state (Trash and Archive included), reads each card fresh and patches only `tags` and `aiTags` through `patchCardWithSearchSync`, so concurrent edits are kept. Rename writes the name as given (a case-only rename recases); merge keeps the casing a card already uses for the target. AI tags stay AI tags. One running operation per user. A run that makes no progress for two minutes (a lost batch, seen when the shared dev deployment briefly ran another branch's code mid-run) shows as "Couldn't finish" with Retry, and starting another marks it failed. Errors: `TAG_EXISTS` (rename onto an existing tag) and `TAG_OPERATION_RUNNING`, both 409.
- **Tag filter:** a tag opened from the Tags page is `?tag=` on the library (and works on any view or folder) (lowercased, shown as a removable chip, kept in history like types). `searchCardsPaginated` takes `tag` and pages the tag index in date order (200-row batches when a folder or visual filter narrows it further); a search with a tag filters its matches.
- **Passes:** an operation pages the tag index from the start again two seconds after a pass that changed cards, up to four passes, and completes after a pass changes none. That catches cards whose index rows landed after the change started, or moved behind the cursor (a card restored from Trash). A merge whose target is only in a card's other list (user or AI tags) drops the source instead of adding a second copy.
- **Tags page:** after review, the sidebar tag group became a **Tags** link right below Favorites that opens `/tags` (`TagsScreen` in `packages/ui`). The page has the cards page's header (sidebar toggle, a find box, a sort menu for most used or name) over a bordered list: each row links to `/?tag=` and has a ⋯ menu for rename, merge and delete. It shows 150 rows at a time with "Show more", and each row's menu mounts only while open, so 2,000 tags stay light. A running or just-finished change is applied to the list until the snapshot catches up.
- **Seed packs:** `tags-2000` (1,000 cards, 2,000 distinct tags plus shared "design", "reference" and "inspiration"; five pages) and `tags-case` (`Design`/`design`/`DESIGN` across user and AI tags, archived and trashed, with emoji, RTL, CJK and 64-character tags).
- **Tests:** `tagOperations.test.ts` (convex-test) covers operations, the snapshot and the grid's tag filter; the rewrite rule is in `__tests__/shared/tags.test.ts` instead of `__tests__/tags/tagSummary.test.ts`; HTTP handlers in `__tests__/publicApiHttpTags.test.ts`; UI helpers in `packages/ui/src/lib/__tests__/tags.test.ts`; `packages/tests/src/web/tags.e2e.ts` and the MCP journey drive it end to end.
- **Break-it fixes:** with a few thousand distinct tags, both the existing `GET /v1/tags` listing and the first snapshot page failed with "too many system operations" (two index lookups per tag). Both now stop at 500 tags per call: the snapshot keeps paging, and `GET /v1/tags` answers from the snapshot when its live listing stops short (requesting a first snapshot if there is none). The merge dialog widened past the screen for a 64-character tag (the form needed `min-w-0`). A reloaded page only followed running changes, so the list showed an old name until the snapshot caught up; it now uses the latest change.
