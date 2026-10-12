## Goal

Add manual folders: flat, colored, many-to-many (a card can live in up to 50 folders), shown in the sidebar, usable from bulk actions, the context menu and the card modal, and available through the API, MCP, SDK and CLI. Phase 5 of the [roadmap](2026-10-12-roadmap-00-roadmap.md).

## Depends on

- [Phase 4](2026-10-12-roadmap-04-sidebar-app-shell.md) (sidebar Folders slot, routed views).

## Success Criteria

- Create, rename, recolor and delete folders (up to 500 per account); add, remove and move cards one at a time or in bulk.
- `/f/[folderId]` lists the folder's cards in `createdAt` order with the active sort, honoring Trash and Archive (trashed or archived cards drop out of the folder view and come back on restore or unarchive).
- Deleting a folder removes it from every card's `folderIds`; deleting an account or hard-deleting a card leaves no folder rows behind.
- `/v1/folders` CRUD, `?folder=` on `/v1/cards`, `folderIds` in card payloads, six MCP tools, SDK `folders.*` and `teak folders …`.

## Context And Current Facts

- `syncCardSearchDocumentHandler` (`card/searchDocumentHelpers.ts:189`) runs inline from `patchCardWithSearchSync` and `scheduleCardSearchSync`, including after a hard delete when the card is gone (`card/deleteCard.ts` and `workflows/cardCleanup.ts` both call `scheduleCardSearchSync` after `ctx.db.delete`). It is the right single place to keep `folderCards` rows in step with the card.
- `patchCardWithSearchSync`'s `searchableFields` list decides whether sync runs; `folderIds` must be added so membership changes reach `folderCards`.
- Account deletion: `accountDeletion.ts deleteAccountDataHandler` deletes each card's `cardSearchTags`, `cardSearchDocuments` and `cardSearchTagSyncStates`; `accountDeletionData.ts ancillaryPage` deletes per-user `apiIdempotencyKeys` and tombstones 100 at a time and returns "more to do".
- Sync clients learn about card changes from `/v1/cards/changes`, which reads `cards.by_updated` (`["userId", "updatedAt"]`), so membership changes bump `card.updatedAt`.
- Public routes are explicit in `http.ts` (exact `path` routes plus a `for` loop of OPTIONS paths, and `pathPrefix: "/v1/cards/"` for by-id routes); folders need `/v1/folders` and a `/v1/folders/` prefix with OPTIONS.
- The card serializer (`publicApiHttpValidation.ts serializeCard`) is an allow-list; `folderIds` must be added there and in the OpenAPI card schema.

## Constraints And Non-goals

- Flat folders only (no nesting); `kind: "smart"` exists in the schema but is used from Phase 8.
- `cards.folderIds` is the source of truth (cap 50); `folderCards` is a derived index table rebuilt by `syncCardFolderRows`.
- All membership writes go through `patchCardWithSearchSync` so `folderCards`, search and `updatedAt` stay consistent.
- Coverage of new tables: `folders` and `folderCards` in `ancillaryPage` (per user, paged) and in `deleteAccountDataHandler` (per card); hard delete removes the card's `folderCards` rows through the sync; folders hold no R2 keys.
- Folder deletion runs as a workflow so big folders page; it warns about (and later detaches) dependent feeds and rules (Phases 16, 17).
- Public API order: `publicApiFolders.ts` internal functions → `publicApiHttpFolders.ts` handlers → `executePublicApiOperation` branches → `http.ts` routes and OPTIONS → `publicApiOpenApi.ts` → `mcp/tools.ts` → `client/sdk.ts` → `apps/cli/src/index.ts` and `library.ts`.

## Backend

- `schema.ts`:
  - `folders { userId, name, nameKey (trimmed lowercase), color?, kind: "manual" | "smart", query?, activeCardCount, createdAt, updatedAt }` with `by_userId_and_nameKey`, `by_userId_and_createdAt`.
  - `cards.folderIds: v.optional(v.array(v.id("folders")))`.
  - `folderCards { folderId, cardId, userId, isDeleted?, isArchived?, type, cardCreatedAt, addedAt }` with `by_folder_deleted_archived_created`, `by_cardId_and_folderId`, `by_userId`.
- `folders/folders.ts`: `createFolder`, `renameFolder`, `setFolderColor`, `deleteFolder`, `listFolders` (with `activeCardCount`), unique `nameKey` per user, cap 500.
- `folders/membership.ts`: `addCardsToFolder`, `removeCardsFromFolder`, `moveCardsToFolder`; ownership checks on both card and folder; cap 50 per card; bumps `card.updatedAt`.
- `syncCardFolderRows(ctx, card | null)` called from `syncCardSearchDocumentHandler`: diff `folderIds` against `folderCards`, copy `isDeleted`, `isArchived`, `type`, `createdAt`; adjust `activeCardCount`.
- `workflows/folderDeletion.ts`: page through `folderCards` for the folder, strip the id from each card, delete rows, then the folder.
- `searchCardsPaginated` gains optional `folderId`; the list path reads `folderCards.by_folder_deleted_archived_created`.
- Bulk core (`card/bulkUpdate.ts`): `addToFolder`, `removeFromFolder`, `moveToFolder` ops.

## Web

- `AppSidebar` Folders section: color dot, name, `activeCardCount`, "New folder" (+) button; right-click or "…" menu: Rename, Color, Delete.
- Route `apps/web/src/app/(app)/f/[folderId]/page.tsx` renders `HomePageClient` with `folderId`; unknown or foreign IDs show "Folder not found".
- Bulk bar "More" menu: Add to folder…, Move to folder…, Remove from folder (inside a folder view).
- Card context menu and `CardMetadataPanel.tsx`: "Folders…" opens a searchable checklist (Popover + Command from Phase 4).

## API / MCP / SDK / CLI

- `GET/POST /v1/folders`, `GET/PATCH/DELETE /v1/folders/:id`, `POST /v1/folders/:id/cards` and `DELETE /v1/folders/:id/cards` (body `{ cardIds }`, ≤ 100).
- `GET /v1/cards?folder=<id>`; `folderIds` on card payloads; `PATCH /v1/cards/:id { folderIds }`.
- MCP: `teak_v1_list_folders`, `teak_v1_create_folder`, `teak_v1_update_folder`, `teak_v1_delete_folder`, `teak_v1_add_cards_to_folder`, `teak_v1_remove_cards_from_folder`.
- SDK `folders.list | create | update | delete | addCards | removeCards`; CLI `teak folders ls | create | rename | rm | add | remove`, `teak ls --folder <name|id>`.

## Docs

- `features.mdx`: new "Folders" subsection under "Search and organization".
- `(developers)/api.mdx`, `mcp.mdx`, `(apps)/cli.mdx`: folder endpoints, tools and commands.
- Ship-month changelog: "Organize cards into folders".

## UI states

- Empty: no folders → sidebar shows only "New folder"; an empty folder shows "No cards in this folder yet." with "Add cards" opening selection mode.
- Loading: sidebar folder rows show three skeleton rows; folder view uses the skeleton grid.
- One item / many items: 500 folders scroll inside the sidebar section; counts right-aligned in tabular numbers.
- Very long names: 300-character and RTL names truncate with a tooltip; the dialog input caps at the server limit.
- Error: duplicate name → inline "A folder with this name already exists"; cap reached → "You can have up to 500 folders"; card in 50 folders → toast.
- Rate-limited: not rate-limited; bulk calls chunk at 100.
- UI bar: one primary action per surface ("New folder"); color picker uses a small fixed palette of existing tokens; undo toast on remove and delete.

## Scenario seed packs

- `folders-none`, `folders-one`, `folders-500`; `card-in-50-folders`; `folders-ugly` (emoji, RTL, CJK, 300-character names, names differing only by case); folders holding archived and trashed cards.

## Break-it checklist

- UI: create the same folder twice fast; drag-free bulk add 300 cards; delete a folder while its view is open in another tab; back/forward into a deleted folder; 390px drawer with 500 folders; keyboard-only rename.
- Backend: 501st folder; 51st folder on a card; another user's folder or card ID; delete a folder with 1,000 cards (paged); trash, archive, restore and hard delete a card in three folders (rows follow); account deletion leaves zero `folders` and `folderCards`; concurrent add and remove on the same card (OCC).

## Tests

- `packages/convex/folders.test.ts` (convex-test, add to `vitest.config.ts`): trash and archive flip `folderCards` flags; folder delete clears `folderIds`; hard delete removes rows; account deletion leaves nothing; caps 500 and 50.
- `packages/convex/__tests__/folders/membership.test.ts`: ownership, idempotent add/remove, move semantics, `updatedAt` bump.
- `packages/convex/occContention.test.ts`: concurrent membership edits on one card.
- `packages/convex/__tests__/publicApiHttpFolders.test.ts`: CRUD, bad IDs, missing auth, `?folder=`.
- `packages/convex/__tests__/mcp.test.ts`: six tools listed and mapped.
- `packages/tests/src/web/folders.e2e.ts`: create, add cards, open folder, rename, delete.

## Proof before the PR

- Video: create three folders, bulk add cards, open a folder, archive a card in it, rename and recolor, delete a folder; 390px drawer.
- Screenshots: sidebar with 0, 1 and 500 folders; folder view empty and populated; Folders… checklist; errors; light and dark; 390px and 1440px.
- Captured `/v1/folders` CRUD, `?folder=` listing, MCP output, `teak folders ls`.

## Release gate

1. Narrow tests above, then the repo checks and `folders.e2e.ts`, `03-api.e2e.ts`, `04-cli.e2e.ts`, `05-mcp.e2e.ts`, `07-account-lifecycle.e2e.ts`.
2. Seed the folder packs, run the break-it pass, fix and add regression tests.
3. Proof bundle as above.
4. PR, green CI, merge, deploy Convex then web. No backfill (no card has folders yet). Smoke-test production: create a folder, add a card, list via API, delete the folder.

## Risks And Open Questions

- `activeCardCount` drift under concurrent writes: recompute it in the folder deletion workflow and in Phase 19's audit if needed.
- Six MCP tools grow the tool list; keep descriptions short.
