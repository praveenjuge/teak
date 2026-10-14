## Goal

Let people hide cards by giving them one of the reserved tags `private`, `nsfw` or `hidden`. A hidden card leaves every list and search until you search for that tag. Phase 4 of the [roadmap v2](2026-10-14-roadmap-v2-00-roadmap.md).

## Depends on

- Nothing. Phases 5, 7, 13 and 29 rely on it.

## Success Criteria

- A card with one of the user tags `private`, `nsfw` or `hidden` (any case, any spacing) is hidden, and the card stores `isHidden: true`. Removing the tag shows the card again.
- Hidden cards are left out of all of these:
  - the library grid (Everything, Favorites, Archive, Trash)
  - search and Shuffle
  - folders and smart folders
  - the local search cache
  - `site:` suggestions
  - mobile summaries and Raycast
  - `GET /v1/cards`, MCP `teak_v1_list_cards`, `teak_v1_search_cards` and `teak_v1_list_favorite_cards`
  - `teak ls` and `teak search`
- The only way to show them is a search for one of those tags: `#private`, `tag:nsfw`, the sidebar or tag page's `?tag=hidden`, or a smart folder whose search has the tag. Searching for the plain word `private` does not show them.
- AI tags never hide a card, and the AI tag output never contains a reserved word.
- Getting a card by ID (`GET /v1/cards/:id`, the card modal, `?card=`), `/v1/cards/changes` and exports still include hidden cards, with `isHidden: true` in the JSON.
- Existing cards are backfilled: a dry run first, then pages.

## Context And Current Facts

- Tags are strings in `cards.tags` (user) and `cards.aiTags`. `tagKey(tag)` (`shared/tags.ts:31`) trims and lowercases. AI tags are normalized by `normalizeAiTags` in `workflows/aiMetadata/tags.ts`, called from `workflows/aiMetadata/generators.ts` (lines 99 and 135). The approved plan's `aiMetadata/schemas.ts` holds only the zod schema.
- **Search document.** `patchCardWithSearchSync` (`card/searchDocumentHelpers.ts:206`) patches the card. It schedules the search sync when a search field changes, `tags` included. `syncCardSearchDocumentHandler` (line 246) already repairs a derived card field, `urlHost`, "the one place every card write passes through". `isHidden` follows the same pattern.
- **`cardSearchDocuments`** (`schema.ts:898`) filters on userId, isDeleted, isArchived, type, isFavorited and urlHost. `searchCardsByDocument` (`searchDocumentHelpers.ts:747`) already filters a missing optional field with `.eq("isFavorited", undefined)`, so `.eq("isHidden", undefined)` works the same way.
- **Read paths** that must exclude hidden cards:
  - `card/listQuery.ts`: `buildCardListQuery`, `buildHostCardListQuery`, `buildFolderCardListQuery`, `buildTagCardListQuery`
  - `card/shuffle.ts`: `pageShuffleWalk`
  - `card/visualFilters.ts`: `findVisualMatches`
  - `searchCardsByExactTag` and `searchCardsByDocument`
  - `card/getCards.ts`: `getCards` (line 133), `searchCards` (160) and `searchCardsPaginatedHandler` (344), which `mobileCardSummaries.ts` uses
  - `card/topSites.ts`
  - `raycast.ts`: `getCardsForUser`
  - `publicApi.ts`: `searchCardsPageForUser` (830), `shuffleCardsPageForUser` (1019), `scanCardsPageForUser` (1217)
  - `shared/search/localSearch.ts`: `filterLocalCards`, which `useCardsSearchController` uses for instant local results
- `resolveSearch` (`card/searchPlanner.ts:134`) merges the view's tag with the `tag:`/`#` qualifiers into `tags`, and returns a `matches(card)` predicate. That makes it the single place to decide "this search reveals hidden cards".
- `folderCards` rows copy `isDeleted`/`isArchived` from the card (`schema.ts:753`), and folder listings load each card. Because hidden cards are rare, filtering after the load is enough; no new index is needed.
- Precedents: `isArchived: v.optional(v.literal(true))`, and the backfill `migration/backfillUrlHost.ts` (dry run by default, self-scheduling pages of 100 to 200).

## Constraints And Non-goals

- Define `HIDDEN_TAG_KEYS = ["private", "nsfw", "hidden"]` and `isHiddenTagList(tags)` in `shared/tags.ts`, next to `tagKey`, and re-export them from `shared/constants.ts` so clients import them from one place.
- `cards.isHidden` and `cardSearchDocuments.isHidden` are `v.optional(v.literal(true))`. Add `isHidden` to the search index's `filterFields`. Add no new `cards` index unless a list path measures short pages; the filter runs after the index read.
- Only `card.tags` matters. `isHidden` is derived and never written by a client. It is computed in `patchCardWithSearchSync` when `tags` is in the patch (like `withUrlHost`), and repaired in the search sync.
- Hiding applies in Trash and Archive too, so a private card never appears there unless you search its tag.
- Counts are unchanged: `folders.activeCardCount`, tag counts and the 200-card cap all still include hidden cards.
- Compatibility: native apps that predate this get filtered results from the same queries and need no update. `isHidden` is a new optional JSON field.

## Backend

- `schema.ts`: `cards.isHidden`, `cardSearchDocuments.isHidden` and the filter field.
- `card/hiddenCards.ts`:
  - `withHiddenFlag(value)` for patches
  - `revealsHidden(tags: string[])`
  - `excludeHidden` filter helpers for index queries (`q.neq(q.field("isHidden"), true)`) and for loaded cards
- Card creation and every path that inserts cards (`card/createCard.ts`, `uploadCard.ts`, `defaultCards.ts`, `raycast.quickSaveForUser`, imports) set `isHidden` from the initial tags.
- Every read path in Context takes an `includeHidden` option, which is false by default. `resolveSearch` sets it when `tags` intersects `HIDDEN_TAG_KEYS`.
- `workflows/aiMetadata/tags.ts`: `normalizeAiTags` drops the reserved keys.
- `migration/backfillHiddenCards.ts`: copies `backfillUrlHost`. It sets `isHidden` on cards and their search documents, and skips accounts that are being deleted. A dry run reports counts per tag and the number of affected users.
- `publicApiHttpValidation.ts`: `serializeCard` and `serializeListCard` add `isHidden`. `export/serialize.ts` adds it to exports.

## Web

- Card modal tag editor: adding a reserved tag shows the toast "Hidden. Search #private to see it." with Undo. In a list that doesn't reveal hidden cards, the card leaves the grid optimistically (`hooks/cardQueryOptimisticUpdates.ts`).
- A hidden card's modal shows a small "Hidden" label with an `EyeOff` icon next to the tags.
- Search suggestions (`search/searchSuggestions.ts`): when a reserved tag is typed, add a muted hint "Shows hidden cards".

## API / MCP / SDK / CLI

- No new parameters: the tag qualifier is the switch. OpenAPI documents `isHidden` and the rule. MCP tool descriptions for list and search mention it. The SDK `Card` type gets `isHidden`. `teak ls --json` prints it, and the table output marks hidden cards with "hidden".

## Docs

- `features.mdx`: a "Hidden cards" section.
- `(developers)/api.mdx` and `mcp.mdx`: the rule, and `isHidden`.
- `(apps)/cli.mdx`: a line.
- Ship-month changelog: "Hide cards with private, nsfw or hidden tags", stating that cards already carrying those tags are now hidden.

## UI states

- **Empty:** a view whose cards are all hidden shows the normal empty state plus one quiet line: "Some cards are hidden. Search #private, #nsfw or #hidden to see them." It shows only when the view has hidden cards; check with one bounded `.first()`.
- **Loading:** unchanged skeletons.
- **One / many items:** `#private` with 1 card and with 500 cards pages normally.
- **Very long names:** not applicable (the reserved words are short). Long other tags on hidden cards wrap as today.
- **Error:** if the tag edit fails, the card comes back through the existing optimistic rollback and error toast.
- **Rate-limited:** the API's existing 429 applies. Nothing new.

## Scenario seed packs

- `hidden-mix`:
  - cards tagged `Private`, `NSFW ` and ` hidden` (case and spacing)
  - a hidden card that is also favorited, archived, trashed, in a manual folder and matched by a smart folder
  - a hidden card with a `site:` host
  - a card with only the AI tag `nsfw`, which is not hidden
  - 200 hidden cards among the 1,000 from `ordering`
- Two accounts, to test ownership.

## Break-it checklist

- **UI:**
  - Tag a card `private` while a search is showing it.
  - Untag while searching `#private`; the card leaves the results.
  - Undo the toast quickly.
  - Shuffle and Reshuffle; no hidden card ever appears.
  - The local cache: a card hidden in another tab must not show in instant results.
  - The `?card=` deep link to a hidden card still opens.
  - Back and forward.
  - Two tabs.
  - 390px.
- **Backend:**
  - Every read path, with and without the reveal tag.
  - Another user's hidden card ID.
  - Trashed and archived hidden cards.
  - AI output containing "NSFW".
  - Backfill idempotency and dry-run totals.
  - OCC between a tag edit and the search sync (`occContention.test.ts`).
  - API, MCP and CLI with and without `#private`, with a bad cursor, and without auth.

## Tests

- `packages/convex/__tests__/shared/tags.test.ts`: `isHiddenTagList` over case, spacing and AI-only tags.
- `packages/convex/__tests__/workflows/aiMetadata/tags.test.ts`: reserved words are dropped.
- `packages/convex/hiddenCards.test.ts` (convex-test, add it to `vitest.config.ts`):
  - every read path excludes hidden cards, and the reveal tag includes them
  - folders and smart folders
  - Shuffle and `site:`
  - a get by ID still works
  - `/v1/cards/changes` includes them
  - creating a card with a reserved tag sets the flag
- `packages/convex/__tests__/migration/backfillHiddenCards.test.ts`: the dry run writes nothing, a real run sets both rows, deleting accounts are skipped.
- `packages/convex/__tests__/shared/search/localSearch.test.ts`: `filterLocalCards` drops hidden cards unless the search reveals them.
- `packages/convex/__tests__/publicApiHttpCards.test.ts` and `mcp.test.ts`: `isHidden` in the JSON, and hidden cards excluded by default.
- `packages/tests/src/web/hidden-cards.e2e.ts`: tag a card `private`, it leaves the grid, the toast's Undo brings it back, and searching `#private` shows it.

## Proof before the PR

- **Video:** tag `private`, the card disappears, then search `#private`, untag, it's back.
- **Video, worst case:** a hidden card in a folder, a smart folder and Shuffle, plus the AI-tag `nsfw` card staying visible.
- **Screenshots:** the hint on an empty view, the toast, the modal label, search results. Each in light and dark, at 390px and 1440px.
- Captured `GET /v1/cards` with and without `q=%23private`, MCP `teak_v1_search_cards`, and `teak ls` / `teak search "#private"`.
- The backfill dry-run output.

## Release gate

1. Run the narrow tests, then the repo checks, plus `hidden-cards.e2e.ts`, `search-qualifiers.e2e.ts`, `folders.e2e.ts`, `shuffle.e2e.ts`, `03-api.e2e.ts`, `04-cli.e2e.ts` and `05-mcp.e2e.ts`.
2. Seed `hidden-mix`, run the break-it pass, then fix and add regression tests.
3. Send the proof bundle, including the production dry-run counts.
4. Open the PR; CI must be green. Merge. Deploy Convex (the search index rebuild runs; deploy in a low-traffic window and watch database I/O, per `.agents/convex-costs.md`), then the web app. Run `migration/backfillHiddenCards:backfillHiddenCards` as a dry run, review the counts, then `'{"dryRun":false}'`. Smoke-test production: tag a test card `private`, check web, API and `teak ls`.

## Risks And Open Questions

- **Existing tags.** People who already use `private`, `nsfw` or `hidden` as ordinary tags will see those cards disappear on deploy. The dry run gives the count. Decided: no separate announcement. The ship-month changelog entry already says that cards carrying those tags are now hidden, and the backfill runs right after the deploy.
- **Short pages.** Filtering after the index read can make a page short when many hidden cards cluster together. That's acceptable for rare tags. If a user hides thousands of cards, add `by_user_deleted_archived_hidden_created` next to the existing index.
- **Native views.** Native apps that read Convex directly through other queries must route through the filtered queries. Verify on Apple before merge.
