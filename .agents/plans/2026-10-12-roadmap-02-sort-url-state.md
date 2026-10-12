## Goal

Let people sort the library Newest or Oldest, keep the search and sort in the URL so back, forward, reload and shared links work, and fix the ordering bug where list views sort by insert time but search sorts by `createdAt`. Phase 2 of the [roadmap](2026-10-12-roadmap-00-roadmap.md).

## Depends on

- None. Phase 3 builds on the indexes added here.

## Success Criteria

- Every list and search path orders by `createdAt` both ways; an imported card with an old `createdAt` lands in the right place in All, Favorites, type filters and search.
- A sort toggle (Newest, Oldest) in the search header; `?q=` and `?sort=oldest` in the URL survive reload and back/forward, and `?card=` keeps working beside them.
- `searchCardsPaginated` and the public API accept `sort` (optional, default newest); `searchMobileCardSummariesPaginated` keeps its return shape.
- An API cursor issued before the deploy returns 400 `INVALID_CURSOR`, not 500.

## Context And Current Facts

- `card/getCards.ts`: the paginated list paths read `by_user_deleted`, `by_user_type_deleted` or `by_user_favorites_deleted` with `.order("desc")`, which orders by `_creationTime`. The search path (`searchCardsPaginatedHandler`, about line 492) sorts matches by `createdAt` in memory. Only the date-range path reads `by_created` (`["userId", "createdAt"]`). Imported cards keep their original `createdAt`, so the two orders diverge.
- `searchCardsPaginatedArgsValidator` (`card/getCards.ts:344`) has `paginationOpts`, `searchQuery`, `types`, `favoritesOnly`, `showTrashOnly`, `styleFilters`, `hueFilters`, `hexFilters`, `createdAtRange`. No `sort`.
- `publicApi.ts` already has `ApiCardSort` (`newest | oldest`), `normalizeSort`, and `createBaseQuery` (line 470), which uses `by_created` only for date-filtered listings (`usesCreatedAtOrder`) and `_creationTime` indexes otherwise. `decodeCursor` stores a Convex `page` cursor; a page cursor from a different index fails inside `paginate`.
- `packages/convex/raycast.ts` also reads `by_user_deleted`, `by_user_type_deleted`, `by_user_favorites_deleted` and `by_created`; it should move to `buildCardListQuery` here too, or Raycast lists keep `_creationTime` order.
- `shared/search/localSearch.ts` hard-codes `createdAt` descending in `filterLocalCards` and `mergeCardsIntoLocalSearchCache`.
- `searchMobileCardSummariesPaginated` is in `card/mobileCardSummaries.ts`; native pagers are `apps/apple/Teak/Features/Library/CardPager.swift` and `apps/android/core/data/src/main/kotlin/com/praveenjuge/teak/core/data/repository/CardPager.kt`.
- Web: `HomePageClient.tsx` owns only `?card=` (push/replace with `scroll: false`). `useCardsSearchController` (`packages/ui/src/hooks/useCardsSearchController.ts`, 646 lines) keeps all search state in local `useState`. `CardsSearchHeader.tsx` is a 21-line wrapper. `packages/ui/src/lib/searchUrlState.ts` does not exist yet.
- `apps/web/src/__tests__/searchWiring.test.ts` reads `HomePageClient.tsx` as text, which `.agents/testing.md` forbids; this phase replaces it with a behavior test.
- There is no user-scoped `deletedAt` index; Trash ordering by `deletedAt` needs `by_user_deleted_deletedAt`.

## Constraints And Non-goals

- New Convex args are optional; `searchMobileCardSummariesPaginated` return shape is unchanged.
- Schema: add `cards.isArchived: v.optional(v.literal(true))` and `archivedAt: v.optional(v.number())` now, unused until Phase 3, so the new indexes are built once.
- New indexes go beside the old ones; legacy `_creationTime` indexes are dropped only in Phase 19.
- No backfill: `createdAt` already exists on every card and `isArchived` is absent on all of them.
- Public API order: `sort` already exists on `GET /v1/cards`; only the shared query builder changes, plus the 400 cursor mapping in `publicApiHttpCards.ts` and the OpenAPI note.

## Backend

- `schema.ts` cards indexes:
  - `by_user_deleted_archived_created`: `["userId", "isDeleted", "isArchived", "createdAt"]`
  - `by_user_deleted_archived_type_created`: `["userId", "isDeleted", "isArchived", "type", "createdAt"]`
  - `by_user_deleted_archived_favorited_created`: `["userId", "isDeleted", "isArchived", "isFavorited", "createdAt"]`
  - `by_user_deleted_deletedAt`: `["userId", "isDeleted", "deletedAt"]` (Trash, most recently deleted first)
- New `card/listQuery.ts buildCardListQuery(ctx, { userId, view, type?, favorited?, sort })` returning an ordered query; used by `getCards.ts` list paths and `publicApi.ts createBaseQuery`.
- Optional `sort: v.optional(v.union(v.literal("newest"), v.literal("oldest")))` on `searchCardsPaginatedArgsValidator`; the search path sorts by `createdAt` in the requested direction, ties broken by `_id`.
- `shared/search/localSearch.ts` takes `sort` so local and remote merges agree.
- `publicApi.ts decodeCursor`/paginate: catch a page cursor from an old index and throw `invalidCursorError()` (400).

## Web

- `packages/ui/src/lib/searchUrlState.ts`: pure `parseSearchUrlState(params)` and `serializeSearchUrlState(state, params)` for `q` and `sort`, preserving unknown params such as `card`.
- `useCardsSearchController` becomes controllable: optional `value`/`onChange` for `searchQuery` and `sort`, internal state when uncontrolled (native and extension callers unchanged).
- `apps/web/src/app/HomePageClient.tsx` reads and writes `q` and `sort` with `router.replace` while typing (debounced) and `router.push` on sort change, keeping `?card=`.
- `search/CardsSearchHeader.tsx`: a quiet sort toggle (Newest / Oldest dropdown, `ArrowDownWideNarrow` icon).

## API / MCP / SDK / CLI

- `GET /v1/cards?sort=` now orders by `createdAt` on every path; MCP `teak_v1_list_cards` and `teak_v1_search_cards` describe `sort`; SDK `qs` passes `sort`; `teak ls --sort oldest` if the flag is not already wired.

## Docs

- `features.mdx` "Grid": sorting and shareable search URLs.
- `(developers)/api.mdx` "Search and favorites": `sort` orders by saved date; old cursors return 400 after this release.
- `october-2026.mdx` (or the ship month): "Sort your library oldest first".

## UI states

- Empty: "No cards yet" or the existing no-results copy; the toggle still shows.
- Loading: skeleton grid while the first page loads after a sort change; no spinner.
- One item / many items: order flips without layout jump; scroll resets to top on sort change only.
- Very long names: a 300-character `q` in the URL round-trips and the input truncates.
- Error: a malformed `sort` value falls back to newest silently.
- Rate-limited: not applicable (queries only).
- UI bar: the toggle is a ghost dropdown, not a second primary button; focus ring and keyboard reachable.

## Scenario seed packs

- `ordering`: 1,000 cards across all 8 types with imported `createdAt` spread over ten years, interleaved with new cards so `_creationTime` and `createdAt` disagree; favorites and trashed cards in the mix.

## Break-it checklist

- UI: toggle sort ten times fast; back/forward through five URL states; reload with `?q=…&sort=oldest&card=…`; paste a URL with an unknown `sort`; open two tabs with different sorts; slow network while paging.
- Backend: old API cursor (400); cursor from the other sort direction; `sort` with a bad value (400 via validator); oldest sort reaching the last page; two cards with the same `createdAt` (stable order, no duplicates across pages).

## Tests

- `packages/convex/__tests__/card/getCards.test.ts`: imported card sorts by `createdAt` in list, type, favorites and search paths, newest and oldest.
- `packages/convex/__tests__/publicApi.test.ts` (or `publicApiPaginationHttp.test.ts`): old-index cursor returns 400; equal `createdAt` pages without duplicates.
- `packages/ui/src/lib/__tests__/searchUrlState.test.ts`: round-trip, unknown params preserved, bad `sort` ignored.
- `packages/ui/src/hooks/__tests__/useCardsSearchController.hook.test.tsx`: controlled mode reports changes and honors external values.
- `apps/web/src/__tests__/searchWiring.test.ts`: replace the source-text assertions with a render of `HomePageClient` that checks the URL updates.

## Proof before the PR

- Video: search, switch to Oldest, open a card, back, forward, reload; share the URL into a new tab.
- Screenshots: sort menu open; oldest-first grid with an imported card at the top; empty search; light and dark; 390px and 1440px.
- Captured `GET /v1/cards?sort=oldest` response and the 400 body for an old cursor.

## Release gate

1. Narrow tests above, then the repo checks and `packages/tests/src/journey/02-web-journey.e2e.ts` and `03-api.e2e.ts`.
2. Seed `ordering`, run the break-it pass, fix and add regression tests.
3. Proof bundle as above.
4. PR, green CI, merge, deploy Convex (index build on deploy; watch database I/O) then web. No backfill. Smoke-test production: oldest sort on web, `GET /v1/cards?sort=oldest`, and a native app library scroll.

## Risks And Open Questions

- Convex paginate cursors reset on deploy because the list paths change index. Verify the iPhone, iPad, Mac and Android pagers restart cleanly from an invalid cursor before merging.
- Four new `cards` indexes build on deploy; schedule the deploy for a quiet hour.
