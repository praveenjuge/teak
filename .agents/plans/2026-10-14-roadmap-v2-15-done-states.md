## Goal

Let people mark a link card as read, watched, listened, bought, cooked, played or done, and find what is left with `is:todo` and what is finished with `is:done`, on the web and through the API, MCP, SDK and CLI. Phase 15 of the [roadmap v2](2026-10-14-roadmap-v2-00-roadmap.md).

## Depends on

- Nothing in v2. v1 phase 19 (Hardening) has shipped.
- Phase 18 (new link categories) has shipped: `place`, `typeface`, `social_post`, `app`, `game` and `repo` already exist. Its last items belong to this phase: `app` and `game` are actionable, so `is:todo` includes them, and a game card's toggle reads "Mark as played" (an app card's reads "Mark as done").

## Success Criteria

- A link card's detail panel has one toggle whose wording follows its category: "Mark as read" for an article, "Mark as watched" for a movie, and so on. Toggling it sets or clears one optional `cards.completedAt`, with an undo toast.
- `is:done` shows cards with `completedAt`. `is:todo` shows link cards in an actionable category that are not done. Both work in the search box, smart folders, the API `q`, MCP `search_cards` and `teak cards search`.
- `POST /v1/cards/:id/done` and `DELETE /v1/cards/:id/done`, MCP `teak_v1_set_card_done`, SDK `cards.setDone`, CLI `teak done <id>` / `--undo`.
- No bulk action, no keyboard shortcut, no starter folders (owner decision).
- Native apps keep working: they ignore the new field.

## Context And Current Facts

- `cards` has no done field (`cardValidator`, `schema.ts:448`). `completedAt` exists today only inside processing stage statuses (`schema.ts:50`) and job tables, never on a card.
- Categories live in `packages/convex/shared/linkCategories.ts`: 21 values in `LINK_CATEGORIES`, with `LINK_CATEGORY_LABELS` and `LINK_CATEGORY_ICONS` as exhaustive `Record<LinkCategory, …>` maps. Only tests read the labels and icons; the web never shows a category name.
- A card's category is `metadata.linkCategory.category`, validated by `linkCategoryValidator`. That validator is built from `LINK_CATEGORIES` in `schema.ts:25-31`.
- `shared/search/qualifiers.ts`:
  - `SEARCH_QUALIFIER_KEYS` is `tag, type, is, site, folder`.
  - `is:` accepts only `fav` and `archived` (`FAVORITE_WORDS`, `ARCHIVED_WORDS`, `SearchIsValue`).
  - `combineSearchQueries` adds `is:` values together across a smart folder and the typed search.
- `card/searchPlanner.ts resolveSearch` returns a card-level `matches(card)` and a `hasCardFilters` flag.
  - In `card/getCards.ts:771`, `hasCardFilters` switches the library to batch scans (`FOLDER_FILTER_SCAN_BATCH`), the same way `site:` and phrases work.
  - Text searches read at most `SEARCH_INDEX_RESULT_LIMIT = 1024` candidates and then filter them.
- Two client-side places mirror the qualifiers:
  - `shared/search/localSearch.ts filterLocalCards` filters cached cards the same way.
  - `packages/ui/src/components/search/searchSuggestions.ts:63-68` lists the `is` options, and `SearchBar.tsx:148` picks their icon.
- Edits go through `updateCardField`, whose `updateCardFieldValidator` (`card/updateCard.ts:37-48`) is a list of literals: `isFavorited`, `archive`, `unarchive` and so on. Native apps call it too.
- Favorite in the API is `PATCH /v1/cards/:id/favorite {isFavorited}`. It runs `raycast.setCardFavoriteForUser` and is routed by `parseCardRoute` (`publicApiHttpValidation.ts:615`).
- `http.ts:193-215` already routes GET, PATCH, POST and DELETE on the `/v1/cards/` prefix, so `/done` needs no new route.
- `serializeCard` and `serializeListCard` (`publicApiHttpValidation.ts:105,143`) expose `linkFacts` through `serializeDisplayMetadata`, but not the category.
- CLI favorites: `teak cards favorite <id> --remove` and the top-level `teak fav` (`apps/cli/src/index.ts:541,823`). The search help string at `index.ts:185` lists the qualifiers.
- Export: `export/serialize.ts serializeCard` emits id, type, content, tags, isFavorited, dates, url, notes, colors and file. v1 phase 11 extends it.
- Native apps decode `linkCategory.category` as a plain optional string: Apple `Card.swift:193-194`, Android `Card.kt:98-99`. Neither reads unknown card fields.

## Constraints And Non-goals

- `completedAt: v.optional(v.number())` on `cards` only. No search-document field and no new index: `is:done` and `is:todo` are card-level filters, like `site:`.
- `is:todo` narrows the view's types to `link`. `is:done is:todo` together match nothing.
- The toggle is for link cards only. The API refuses other types with 400 `UNSUPPORTED_CARD_TYPE`, and trashed cards with 409, the same as Refresh details.
- The write goes through the same `updateCardFieldForUserHandler` path as `isFavorited`, and it bumps `updatedAt` so `/v1/cards/changes` picks it up.
- Analytics: add `card_done_toggled { done, category, surface }` to `shared/analytics.ts` first.

## Backend

- `schema.ts`: `cards.completedAt`.
- `shared/linkCategories.ts`:
  - `LINK_CATEGORY_DONE_VERB: Record<LinkCategory, "read" | "watched" | "listened" | "bought" | "cooked" | "played" | "done">`:
    - read: book, article, news and research
    - watched: movie and tv
    - listened: podcast and music
    - bought: product
    - cooked: recipe
    - done: everything else
    - played: game
  - `ACTIONABLE_LINK_CATEGORIES`: book, movie, tv, article, news, podcast, music, product, recipe, course, event, app and game.
  - `doneActionLabel(category?: string)`, which also gives "done" for an unknown string or a missing category.
- `card/updateCard.ts`: add `"done"` and `"undone"` literals to `updateCardFieldValidator`. `done` keeps an existing `completedAt` and sets it to now only when it is absent, so a retry never moves the date. `undone` clears it. Both are idempotent.
- `raycast.ts` (next to `setCardFavoriteForUser`): `setCardDoneForUser({ userId, cardId, done })` for the API and MCP.
- `qualifiers.ts`:
  - `SearchIsValue` gains `done` (words: done, completed, finished) and `todo` (words: todo, to-do).
  - `ParsedSearchQuery` gains `done` and `todo` booleans.
  - The canonical forms are `is:done` and `is:todo`.
- `searchPlanner.ts`:
  - `matches` checks `completedAt` and, for `is:todo`, `ACTIONABLE_LINK_CATEGORIES.has(card.metadata?.linkCategory?.category)`.
  - `hasCardFilters` is true for either qualifier.
  - It returns null for `is:done is:todo`, and for `is:todo` when the view's types exclude `link`.
- `localSearch.ts filterLocalCards`: the same rules.

## Web

- `card-modal/CardMetadataPanel.tsx`:
  - Add a `PanelButton` beside Favorite, for link cards only.
  - Icons are `Circle` and `CircleCheck`. Both labels come from `doneActionLabel(category)`: "Mark as <verb>" when the card is not done ("Mark as read", "Mark as watched"), and the capitalized verb ("Read", "Watched") with `aria-pressed` when it is.
  - The update is optimistic, with an undo toast that uses the same verb: "Marked as watched · Undo".
- `cards/Card.tsx`: a done link tile shows a quiet `CircleCheck` next to the hostname, labelled for screen readers.
- `searchSuggestions.ts` / `SearchBar.tsx`: add "Done" and "To do" to the `is:` suggestions, with icons.

## API / MCP / SDK / CLI

- `parseCardRoute` gains the operations `done` (POST `/v1/cards/:id/done`) and `undone` (DELETE). Both return 200 with the card and are idempotent. Another user's card returns 404.
- `completedAt: number | null` goes in both serializers. `linkCategory: string | null` goes in `serializeDisplayMetadata`.
- `publicApiOpenApi.ts`:
  - two operations
  - card schema fields, with `linkCategory` typed as a plain string, not an enum
  - the `q` description lists `is:done` and `is:todo`
- MCP: add `teak_v1_set_card_done { cardId, done }` (copy `teak_v1_set_card_archived`), and update the `search_cards` description.
- SDK: `cards.setDone(id, done)`, plus the new fields on the `Card` type.
- CLI:
  - `teak cards done <id> [--undo]`, aliased as the top-level `teak done`
  - the search help lists the new qualifiers
  - `cards get` prints "Done <date>"
- Export: `completedAt` as a `DualTimestamp` when set.

## Docs

- `content/docs/features.mdx`:
  - a "Read, watch and buy" subsection under Search and organization
  - two rows in the Smart search qualifier table
- `(developers)/api.mdx`, `mcp.mdx`, `(apps)/cli.mdx`.
- The ship month's changelog: "Mark links as read, watched or bought".

## UI states

- Empty: `is:todo` with nothing left shows "Nothing left to do." `is:done` with nothing shows the standard empty search.
- Loading: the toggle flips at once (optimistic). The grid skeletons while a batch scan loads.
- One item / many items: one card shows the check. 1,000 done cards scroll with the normal batch paging.
- Very long names: the label is at most 16 characters. The tile check never pushes the hostname off the tile.
- Error: a failed toggle reverts and shows "Couldn't update. Try again."
- Rate-limited: none of its own. The API uses `publicApiRequests`.

## Scenario seed packs

- `done-states`:
  - one link card per category, half of them done
  - done cards in Trash and in Archive
  - a link card whose metadata is still pending (no category)
  - 1,000 image-only cards, so `is:todo` returns nothing
  - a smart folder `is:todo folder:"Reading list"`
  - done cards with 300-character, RTL and CJK titles

## Break-it checklist

- UI:
  - double-click the toggle
  - toggle, then reload before the undo toast ends
  - two tabs toggling the same card
  - toggle offline, then reconnect
  - `is:todo` while a card is marked done in another tab
  - keyboard only
  - 390px panel
- Backend:
  - `is:done is:todo`
  - `is:todo type:image`
  - `is:todo` inside a smart folder with `type:` filters
  - POST twice and DELETE when not done (idempotent; the second POST keeps the first `completedAt`)
  - a non-link card, a trashed card and another user's ID
  - Apple and Android fixtures decoding a card with `completedAt`

## Tests

- `packages/convex/__tests__/shared/linkCategories.test.ts`: every category has a verb, and the actionable set is as above.
- `packages/convex/__tests__/shared/search/qualifiers.test.ts`: parsing, synonyms, canonical form, `combineSearchQueries`.
- `packages/convex/__tests__/shared/search/localSearch.test.ts`: done and todo filtering.
- `packages/convex/searchQualifiers.test.ts` (convex-test, already in `vitest.config.ts`): `is:done` and `is:todo` across batch pages, archive and trash.
- `packages/convex/__tests__/card/updateCard.test.ts`: `done` and `undone` set and clear the field, are idempotent (a repeated `done` keeps the original `completedAt`), and refuse trashed cards and other users' cards.
- `packages/convex/__tests__/publicApiHttpCards.test.ts`, `__tests__/mcp.test.ts`, `__tests__/sdk.test.ts`, `__tests__/export/serialize.test.ts`.
- `apps/cli/src/commands.test.ts`: `teak done` and `--undo` stdout and exit codes.
- UI:
  - `packages/ui/src/components/card-modal/__tests__/CardMetadataPanel.test.tsx` (new): the not-done and done labels per category, including an unknown or missing category ("done")
  - `cards/__tests__/Card.test.tsx`: the done mark
- e2e: `packages/tests/src/web/done-states.e2e.ts` (new), plus `journey/03-api.e2e.ts`, `04-cli.e2e.ts` and `05-mcp.e2e.ts`.

## Proof before the PR

- Video 1: mark an article read, undo it, then search `is:todo` and watch it reappear.
- Video 2: a smart folder with `is:todo`, toggled from a second tab.
- Screenshots of the panel (not done and done, for book, movie, podcast, product and recipe), the done tile, empty `is:todo`, and the error toast. Each in light and dark, at 390px and 1440px.
- Captured `POST`/`DELETE /v1/cards/:id/done`, MCP `teak_v1_set_card_done`, and `teak done <id>` / `--undo` output.

## Release gate

1. Run the narrow tests above, then the repo checks and the e2e specs listed.
2. Seed `done-states`, run the break-it pass, and fix and add regression tests until it comes back clean.
3. Send the proof bundle to the owner.
4. Open the PR. With CI green, merge and deploy Convex, then web. There is no Files Worker change and no backfill. Smoke-test production: toggle a card, then `is:todo` in the web app and through `teak cards search`.

## Risks And Open Questions

- **The master plan expects an index rebuild in phase 15.** This phase needs none: done and todo are card-level filters with batch scans. Add a `by_user_deleted_archived_completed` index later only if p95 for `is:done` alone on a 10,000-card library is too slow. Measure it on dev.
- **Naming.** `completedAt` on a card shares its name with the processing-stage `completedAt`. Keep the docstring explicit.
- **API shape.** The approved plan uses POST and DELETE on `/done`, while favorite uses `PATCH /favorite {isFavorited}`. POST and DELETE need no new route. Confirm with the owner before building.
- **Link cards only.** Decided by the owner: done states are for link cards only. Notes, images and other types are not markable.
