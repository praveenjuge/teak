## Goal

Add Archive (hide a card from the library without deleting it) and real bulk actions (favorite, archive, tags, copy links, delete, restore) on the web and the public API, backed by one server-side bulk core. Phase 3 of the [roadmap](2026-10-12-roadmap-00-roadmap.md).

## Depends on

- [Phase 2](2026-10-12-roadmap-02-sort-url-state.md) (`cards.isArchived`, `archivedAt` and the `by_user_deleted_archived_*` indexes).

## Success Criteria

- Archived cards are hidden from All, Favorites, type filters, search, tag listings and color search, and visible only in the Archive view or with `is:archived` (Phase 7). They still count toward the 200-card cap.
- Selecting up to 300 cards and choosing Favorite, Archive, Add tags, Remove tags, Copy links or Delete (Restore in Trash) applies to all of them, with an undo toast for Archive and Delete.
- `bulkUpdateCards` rejects more than 100 IDs per call and reports `failedIds`; the web chunks larger selections.
- API, MCP and CLI can archive, unarchive, list archived cards and run the new bulk ops.

## Context And Current Facts

- `updateCardFieldValidator` (`card/updateCard.ts`) accepts `content | url | notes | metadataTitle | tags | aiSummary | isFavorited | removeAiTag | delete | restore`.
- Search state: `cardSearchDocuments.search_searchableText` filters on `userId, isDeleted, type, isFavorited`. The card-native visual indexes (`search_visual_styles`, `search_color_hexes`, `search_color_hues`) filter on the same four fields, so they also need `isArchived` or archived cards leak into color search.
- `cardSearchTags` has `by_user_tag_deleted_created`, `_type`, `_favorited`, `_type_favorited`. The tag-sync snapshot (`CardSyncSnapshot` in `card/searchDocumentHelpers.ts`) copies `tags, aiTags, isDeleted, type, isFavorited, cardCreatedAt, userId`; `isArchived` must join it.
- `patchCardWithSearchSync`'s `searchableFields` list must gain `isArchived`, or archive writes skip the sync.
- Public bulk: `executeBulkCardsForUser` (`publicApi.ts:1139`) supports `create | update | favorite | delete`, caps at `MAX_BULK_ITEMS = 100`, and returns per-item `results` (no `failedIds`).
- Web bulk delete: `handleBulkDeleteCards` in `packages/convex/client/hooks/useCardActions.client.tsx` runs one mutation per card and returns `{ requestedCount, deletedCount, failedIds }`. `selection/BulkActionBar.tsx` (58 lines) only has Delete and Cancel; `grids/MasonryGrid.tsx` owns selection mode.
- Usage: `card/cardUsage.ts` counts cards that are not in Trash; archive must not call `recordActiveCardRemoved`.
- `listTagsForUser` (`publicApi.ts:830`) counts active rows with `isDeleted: undefined`; archived rows must be excluded there too.

## Constraints And Non-goals

- `isArchived` is `v.optional(v.literal(true))`; unarchive writes `undefined`. No backfill.
- Search-affecting writes go through `patchCardWithSearchSync`; tag rows get `isArchived` through the snapshot and new `_v2` indexes added beside the old ones (old ones dropped in Phase 19).
- Archive and Trash are exclusive: trashing an archived card keeps `isArchived` so restore returns it to Archive.
- Public API order: `performBulkUpdate` core in `card/bulkUpdate.ts` used by `executeBulkCardsForUser` → `handleBulkCardsRequest` and `handleCardsByIdV1Request` (PATCH `isArchived`) → list parsing of `archived` → no new routes → `publicApiOpenApi.ts` → `mcp/tools.ts` → `client/sdk.ts` → CLI.
- No sidebar yet: a temporary "Archived" pill in the search header opens the Archive view until Phase 4.

## Backend

- `schema.ts`: `isArchived: v.optional(v.literal(true))` on `cardSearchDocuments` and `cardSearchTags`; add `isArchived` to all four search indexes' `filterFields`; `cardSearchTags` `_v2` indexes `by_user_tag_deleted_archived_created_v2` (and `_type_`, `_favorited_`, `_type_favorited_` variants).
- `updateCardField` gains `archive` and `unarchive` (sets `archivedAt`, clears it on unarchive).
- `card/bulkUpdate.ts`: session mutation `bulkUpdateCards({ cardIds, op, tags? })` with `cardIds` ≤ 100 and `op` in `favorite | unfavorite | archive | unarchive | addTags | removeTags | delete | restore`. A shared `performBulkUpdate(ctx, userId, cardIds, op)` returns `{ updatedIds, failedIds }`, skips cards the caller does not own, and is idempotent per card.
- List, search, tag and visual-search readers filter `isArchived` unless the view is Archive.

## Web

- `selection/BulkActionBar.tsx`: count, one primary action (Archive; Restore in Trash), a "More" dropdown with Favorite, Unfavorite, Add tags…, Remove tags…, Copy links, Delete; Cancel.
- `grids/MasonryGrid.tsx`: split selections over 100 into sequential chunks with one progress toast and one undo.
- Archive and Unarchive in `cards/Card.tsx` context menu and `CardMetadataPanel.tsx`.
- Temporary "Archived" pill in the header that toggles the Archive view.

## API / MCP / SDK / CLI

- `PATCH /v1/cards/:id` accepts `{ isArchived: boolean }`; `GET /v1/cards?archived=only|include` (default excludes).
- `POST /v1/cards/bulk` gains ops `archive`, `unarchive`, `addTags`, `removeTags`, `restore`, and returns `failedIds`.
- MCP `teak_v1_set_card_archived`; `teak_v1_bulk_cards` op enum extended. SDK `cards.setArchived(id, bool)`. CLI `teak archive <ids...>`, `teak unarchive <ids...>`, `teak ls --archived`.

## Docs

- `features.mdx`: new "Archive" subsection beside "Trash"; "Grid" mentions bulk actions.
- `(developers)/api.mdx`, `mcp.mdx`, `(apps)/cli.mdx`: archive fields, filters and bulk ops.
- Ship-month changelog: "Archive cards and act on many at once".

## UI states

- Empty: Archive view shows "Nothing archived. Archive a card to keep it out of your library." and no action button.
- Loading: skeleton grid; the bulk bar shows "Archiving 120 of 300…" in the toast, not a spinner overlay.
- One item / many items: labels read "1 card" / "300 cards".
- Very long names: tag names in Add/Remove tags dialogs truncate; the dialog never widens.
- Error: partial failure toast "Archived 298 cards. 2 couldn't be changed." with Retry.
- Rate-limited: not rate-limited server-side beyond the 100-item cap; chunking keeps calls sequential.
- UI bar: undo toast for Archive and Delete; selection keyboard-reachable; bar sits above the toaster (`registerBulkActionBar`).

## Scenario seed packs

- `archive-mix`: 1,000 cards with 200 archived, 100 trashed, 20 archived then trashed, favorites in each state, tags differing only by case across archived and active cards.

## Break-it checklist

- UI: select 300 and archive; undo mid-chunk; double-click Archive; reload during a chunked run; two tabs archiving the same cards; offline then reconnect mid-bulk; 390px bar layout.
- Backend: 101 IDs (rejected); another user's IDs (in `failedIds`, nothing changed); already-archived card (idempotent); archive a trashed card; restore an archived trashed card (returns to Archive); archived card still counts toward the cap; OCC: archive while the tag sync chain runs.

## Tests

- `packages/convex/archive.test.ts` (convex-test, add to `vitest.config.ts`): hidden/visible matrix across list, search, tag listing, color search and Archive view; cap unchanged by archive.
- `packages/convex/__tests__/card/bulkUpdate.test.ts`: every op; 101 rejected; foreign IDs in `failedIds`; idempotent retries.
- `packages/convex/occContention.test.ts`: bulk archive racing a tag sync and an edit.
- `packages/convex/__tests__/publicApiHttpCards.test.ts`: `archived=only|include`, PATCH `isArchived`, bulk ops and `failedIds`.
- `packages/ui/src/components/selection/__tests__/BulkActionBar.test.tsx`: menu items per view, counts.
- `packages/tests/src/web/bulk-actions.e2e.ts`: select, archive, undo, Archive view, restore.

## Proof before the PR

- Video: select 150 cards, archive, undo, archive again, open the Archive view, unarchive one; bulk add tags; trash and restore an archived card.
- Screenshots: bulk bar and menu; Archive empty and populated; partial-failure toast; light and dark; 390px and 1440px.
- Captured `PATCH {isArchived:true}`, `GET ?archived=only`, bulk response with `failedIds`, `teak archive` output.

## Release gate

1. Narrow tests above, then the repo checks and `bulk-actions.e2e.ts`, `02-web-journey.e2e.ts`, `13-occ-concurrency.e2e.ts`.
2. Seed `archive-mix`, run the break-it pass, fix and add regression tests.
3. Proof bundle as above.
4. PR, green CI, merge, deploy Convex (search index rebuilds on deploy) then web. No backfill. Smoke-test production: archive, Archive view, unarchive, and one bulk API call.

## Risks And Open Questions

- Changing four search indexes' `filterFields` rebuilds them; search may be briefly incomplete during the rebuild. Deploy in a quiet hour.
- Until the tag sync re-runs for a card, old tag rows lack `isArchived`; readers treat a missing value as active, which is correct because no card is archived before this deploy.

## As built

Where the shipped change differs from the plan above:

- Readers take an archive scope (`archived: "exclude" | "only" | "include"`, `card/listQuery.ts`) instead of an `isArchived` boolean. Library reads default to `exclude`, the Archive view asks for `only`, and the public API exposes all three as `?archived=`. Trash ignores the scope and lists every trashed card. `include` reads `by_user_deleted_created`, and tag reads that ignore the archive state keep the old `cardSearchTags` indexes; the four `_v2` indexes serve `exclude` and `only`.
- The session mutation is `api.cards.bulkUpdateCards({ cardIds, action, tags? })` in `card/bulkActions.ts`, returning `{ updatedIds, failedIds }`. Its per-card core `applyCardAction` also backs `POST /v1/cards/bulk`, where the new operations take one item per card (`{ cardId }`, or `{ cardId, tags }` for `addTags`/`removeTags`) and every response carries `failedIds`. `favorite` and `delete` moved onto the same core, so repeating them on a card already in that state is a no-op.
- Restoring a card now counts it toward the card limit before writing it, so a refused restore inside a bulk run leaves nothing half-written.
- `removeTags` also clears matching AI tags, and tags match ignoring case. One call names at most 20 tags.
- Web: the bulk bar is a full-width strip across the top of the page (toasts own the bottom edge), with one primary action per view (Archive, Unarchive in Archive, Restore in Trash) and a More menu. Move to Trash no longer asks for confirmation; it offers Undo like Archive and Unarchive. Single-card Archive and Unarchive in the card menu and the card modal use the same toast.
- The Archive view is an **Archived** filter chip beside Trash (or `archived` + Enter in the search bar), exclusive with Trash, until Phase 4's sidebar.
- The `archive-mix` pack labels every card with its state ("Mix #0420 archived, favorite"), so a wrong view is visible at a glance.
- convex-test can't evaluate search indexes over array fields, so the color and style search scope is covered by a fake-index unit test (`__tests__/card/visualFilters.test.ts`) rather than `archive.test.ts`.
