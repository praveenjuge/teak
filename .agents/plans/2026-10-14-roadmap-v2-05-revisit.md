## Goal

Add Revisit, a fourth entry in the View menu's sort section. It opens a full-screen deck of 20 random cards from whatever is on screen. Press ← to archive a card or → to keep it, so tidying old saves becomes a quick game. Phase 5 of the [roadmap v2](2026-10-14-roadmap-v2-00-roadmap.md).

## Depends on

- [Phase 4](2026-10-14-roadmap-v2-04-hidden-cards.md): hidden cards stay out of the deck because the server leaves them out.

## Success Criteria

- The View menu's Sort section reads Newest first, Oldest first, Shuffle, **Revisit**. Choosing Revisit opens the deck over the current view: Everything, Favorites, a folder, a smart folder, a search, a type filter or a tag.
- The deck holds the first 20 cards of a Shuffle of that view, using a new seed, and the card list is fixed when the deck opens. A card that leaves the view during the session doesn't reshuffle the deck.
- Keys:
  - ← or A archives the card (the existing archive action, with an undo toast).
  - → or K keeps it (no write).
  - Space opens the card's details.
  - Z undoes the last archive.
  - Esc exits.
  - On touch screens you can swipe left or right.
- The end screen says "All caught up". "Revisit 20 more" loads the next 20 of the same seed, so there are no repeats. When the view is used up, the button reads "Start over" and picks a new seed.
- The URL is `?sort=revisit&seed=N`. Reload brings back the same deck; Back closes it and returns to the previous sort.
- No backend change. Analytics events: `revisit_started` and `revisit_finished`.

## Context And Current Facts

- `search/ViewMenu.tsx`: `SORT_LABELS: Record<CardListSort, string>` and a `DropdownMenuRadioGroup` with three items. `SearchBar.tsx` (around line 533) renders `ViewMenu`, and shows `ReshuffleButton` while `sort === "shuffle"`.
- `CardListSort = "newest" | "oldest" | "shuffle"` (`shared/search/sort.ts`) is a backend type. `normalizeCardListSort` turns any unknown value into `"newest"`, and the Convex `sort` validator (`cardListSortWithShuffleValidator`, `card/listQuery.ts`) accepts only those three. So Revisit must stay a UI-only mode that queries as `sort: "shuffle"`.
- `lib/searchUrlState.ts`:
  - `parseSearchUrlState` keeps `seed` only when the sort is shuffle.
  - `serializeSearchUrlState` writes `sort` only for oldest and shuffle.
  - Both pass through `normalizeCardListSort`, so `?sort=revisit` would be read as newest today.
- Seeds: `parseShuffleSeed`, `randomShuffleSeed` and `isShuffleSeed` (`shared/search/shuffle.ts`, 0 to 2^31−1). `useCardsSearchController.ts` holds the order state (lines 523–560) and builds `shuffleSeed` / `sort` query args.
- Archive: `useBulkCardActions(toastIdPrefix)` with `"archive"`, as used by `CardsScreen.handleToggleArchive` (`screens/CardsScreen.tsx:389`). It calls `api.cards.updateCardField({ field: "archive" })` and shows the undo toast.
- Cards open in `ConnectedCardModal` through `?card=`.
- Shuffle works in Archive and Trash too (October 2026 changelog), but archiving makes no sense there.
- Client analytics events are typed in `ClientEventCatalog` (`packages/convex/shared/analytics.ts`) and must be added there first (`.agents/analytics.md`).

## Constraints And Non-goals

- Web only. The native decks come in phase 29.
- Revisit is offered wherever the View menu shows Sort, except in Archive and Trash, where it is left out (see Risks).
- The deck renders a fixed snapshot of card IDs and reads each card live for display. An archived card stays on screen, marked "Archived", until you move on.
- Video and audio cards show their poster or waveform. Media doesn't autoplay; Space opens the details to play it.
- Events carry no card data. `revisit_finished` sends `{ archived, kept, completed }` as counts from 0 to 20.

## Backend

- None. `shared/analytics.ts` adds `revisit_started: NoProperties` and `revisit_finished: { archived: number; kept: number; completed: boolean }` to `ClientEventCatalog`.

## Web

- `lib/searchUrlState.ts`:
  - A UI type `LibrarySort = CardListSort | "revisit"`.
  - Parse `?sort=revisit` along with its seed. Serialize it.
  - `queryOrder(state)` maps revisit to `{ sort: "shuffle", shuffleSeed }`.
- `search/ViewMenu.tsx`: a fourth radio item "Revisit" with the `Layers` icon. `viewMenuLabel` reads "View: revisiting".
- `components/revisit/RevisitDeck.tsx`:
  - A full-screen `Dialog` with one large card preview and a progress bar ("7 of 20").
  - Archive and Keep buttons, with the keys shown as `kbd`.
  - Pointer swipe with a threshold.
  - The end screen.
- `hooks/useRevisitDeck.ts`: loads the page of 20 with `searchCardsPaginated`, snapshots the IDs, steps through them, holds the archive undo stack and continues from the cursor.
- `screens/CardsScreen.tsx`: renders the deck when the sort is revisit. Esc and the end screen's "Done" call `router.back()` when the deck was pushed, or else replace the URL with the previous sort.

## API / MCP / SDK / CLI

- None. Revisit is a web view over the existing Shuffle API.

## Docs

- `features.mdx`: a "Revisit" paragraph under "Sort and share a search", with the keys.
- Ship-month changelog: "Revisit: 20 random cards, keep or archive".

## UI states

- **Empty:** a view with 0 cards: Revisit is disabled in the menu, with the hint "Nothing to revisit here".
- **Loading:** a skeleton of one large card and the progress bar while the first page loads.
- **One / many items:**
  - 1 card: the deck says "1 of 1", then the end screen offers "Start over".
  - 19, 20 or 21 cards: the 21st arrives through "Revisit 20 more", and then "Start over" appears.
- **Very long names:** 300-character titles clamp to 3 lines. Very tall images use `object-contain` inside the viewport.
- **Error:**
  - The page fails to load: "Couldn't load cards" with Retry.
  - An archive fails: the existing error toast, and the card stays current.
- **Rate-limited:** not applicable. Archives go through Convex mutations without a client limit.
- **UI bar:** a 180ms slide left or right with a fade on archive and keep. `prefers-reduced-motion` turns it into a crossfade. One primary action per card (Keep is the outline button, Archive the default).

## Scenario seed packs

- `revisit-sizes`: tagged groups of 0, 1, 19, 20 and 21 cards (`#rv0` … `#rv21`), including video, audio, very tall images and every card type. Also 5 hidden cards (from `hidden-mix`) that must never appear.
- Plus `ordering` (1,000 cards) for the "Revisit 20 more" paging.

## Break-it checklist

- **UI:**
  - Archive then Z quickly.
  - Hold ← down (key repeat must not skip cards: ignore `event.repeat`).
  - Double-click Archive.
  - Reload mid-deck (the same seed and the same first card; progress restarts at 1).
  - Back, then Forward.
  - Two tabs archiving the same card.
  - A swipe on touch that is cancelled halfway.
  - Space, then Esc from the details (back in the deck, not out of it).
  - Offline archive, then reconnect.
  - Keyboard only, at 390px.
- **Data:** an archived card appears in Archive and is gone from the view afterwards. A hidden card never appears. A smart folder's deck uses its search.

## Tests

- `packages/ui/src/lib/__tests__/searchUrlState.test.ts`: `?sort=revisit&seed=42` round-trips, a bad seed drops it, and it maps to a shuffle query.
- `packages/ui/src/hooks/__tests__/useRevisitDeck.test.tsx`: stepping, the snapshot ignoring live removals, the undo stack, the "20 more" cursor, and the "Start over" seed change.
- `packages/ui/src/components/search/__tests__/ViewMenu.test.tsx` (`renderToStaticMarkup`): Revisit is listed, absent when told so (Archive/Trash), and disabled when the view is empty.
- `packages/convex/__tests__/shared/analytics.test.ts`: the new events are typed.
- `packages/tests/src/web/revisit.e2e.ts`: choose Revisit, the URL has `sort=revisit`, ← archives with undo, → keeps, Esc returns to the previous sort, and reload keeps the same first card.

## Proof before the PR

- **Video:** Revisit from a tag view: archive, keep, undo, the end screen, "Revisit 20 more".
- **Video, worst case:** holding ←, reload mid-deck, a swipe on a touch emulation, and the 0- and 1-card views.
- **Screenshots:** the menu, the deck, a tall image, a video card, the end screen, the error. Each in light and dark, at 390px and 1440px.

## Release gate

1. Run the narrow tests, then the repo checks, plus `revisit.e2e.ts`, `shuffle.e2e.ts` and `keyboard.e2e.ts`.
2. Seed `revisit-sizes`, run the break-it pass, then fix and add regression tests.
3. Send the proof bundle.
4. Open the PR; CI must be green. Merge and deploy Convex (the analytics catalog only), then the web app. No backfill. Smoke-test production: Revisit a tag, archive one card, undo.

## Risks And Open Questions

- **Archive and Trash.** The decision doesn't cover them. This plan leaves Revisit out of both. An alternative is Revisit in Archive with ← meaning "Unarchive". The owner should decide.
- **"20 more".** The approved plan said it picks a new seed, which could repeat cards. This plan continues the same seed for no repeats and only picks a new seed at the end.
- **Shortcut clash.** The deck's A, K and Z keys must win over the grid shortcuts (F, E, X): the deck is a dialog, so `isOverlayOpen` already silences those.
