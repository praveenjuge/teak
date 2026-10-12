## Goal

Add a Shuffle sort that shows the library in a stable random order for rediscovery, with a Reshuffle button that picks a new order. The order is seeded and deterministic, so paging never repeats or skips a card. Phase 10 of the [roadmap](2026-10-12-roadmap-00-roadmap.md).

## Depends on

- [Phase 2](2026-10-12-roadmap-02-sort-url-state.md) (`sort` arg, `buildCardListQuery`, URL state).

## Success Criteria

- "Shuffle" appears in the sort toggle; choosing it writes `?sort=shuffle&seed=<n>` to the URL. The same seed gives the same order on reload and on another device.
- Reshuffle picks a new seed (new URL entry); back returns to the previous order.
- Paging through every card in shuffle order returns each card exactly once, across the wrap point.
- Search, tag and folder views honor shuffle too (shuffled within their matches); API accepts `sort=shuffle&shuffleSeed=`.

## Context And Current Facts

- After Phase 2, `sort` is `newest | oldest` on `searchCardsPaginatedArgsValidator`, the public API (`ApiCardSort` in `publicApi.ts`) and `searchUrlState`.
- Cards are inserted in three places: `card/createCard.ts:241`, `card/uploadCard.ts:264` and `card/defaultCards.ts:136` (`insertCompletedCards`, also used by `devSeed`). Imports go through `createCard`. Each needs a `shuffleKey`.
- Candidate-set paths (full-text search via `searchCardsByDocument`, exact tag via `searchCardsByExactTag`, and the Phase 7 planner) already collect a bounded candidate list and sort it in memory; a seeded Fisher–Yates fits there.
- The plain list path reads an index in order and paginates with Convex cursors; a cyclic walk over a `shuffleKey` index fits there.

## Constraints And Non-goals

- `cards.shuffleKey: v.optional(v.number())` set once at insert (uniform in [0, 1)), never changed by edits, so it needs no search sync.
- New index `by_user_deleted_archived_shuffle` (`["userId", "isDeleted", "isArchived", "shuffleKey"]`) beside the old ones.
- Backfill `migration/backfillShuffleKey.ts`: dry run first, paged, idempotent (skip cards that have a key).
- New args optional; the mobile summaries query keeps its return shape (it may accept `sort: "shuffle"` later, not required now).
- Public API order: `publicApi.ts` sort union and cursor mode → `publicApiHttpCards.ts` parsing of `shuffleSeed` → no new route → `publicApiOpenApi.ts` → `mcp/tools.ts` (sort enum) → `client/sdk.ts` → CLI `--sort shuffle --seed`.

## Backend

- Insert sites set `shuffleKey: Math.random()`.
- `card/listQuery.ts`: `sort: "shuffle"` with `shuffleSeed` → start key `s = hash(seed) / 2^32`; read `shuffleKey >= s` ascending, then wrap to `shuffleKey < s`; the cursor records the phase (before or after wrap) and the Convex page cursor.
- Candidate paths: seeded Fisher–Yates (small PRNG such as mulberry32 seeded from `shuffleSeed`) over the candidate list, then offset paging as today.
- Cards without a key (before the backfill finishes) sort as if `shuffleKey = 0`, so they appear in the first wrap segment and are never lost.
- `migration/backfillShuffleKey.ts`: `{ cursor?, dryRun = true, batchSize }`, returns counts and continues itself.

## Web

- Sort toggle adds "Shuffle" (`Shuffle` icon); while shuffle is active a small icon button "Reshuffle" sits next to it.
- `searchUrlState` adds `seed`; reshuffle uses `router.push` so back restores the old order.

## API / MCP / SDK / CLI

- `GET /v1/cards?sort=shuffle&shuffleSeed=42` (seed required with shuffle, 400 if missing or not an integer).
- MCP list/search tools accept `sort: "shuffle"` and `shuffleSeed`; SDK passes both; CLI `teak ls --sort shuffle --seed 42`.

## Docs

- `features.mdx` "Grid": Shuffle and Reshuffle.
- `(developers)/api.mdx` "Search and favorites": `sort=shuffle` and `shuffleSeed`.
- Ship-month changelog: "Shuffle your library".

## UI states

- Empty: same empty state as the view; Reshuffle hidden.
- Loading: skeleton grid on reshuffle; old cards fade out with the existing animation.
- One item / many items: one card shows alone; 1,000 cards page without repeats.
- Very long names: not applicable.
- Error: a malformed `seed` in the URL is replaced with a fresh one.
- Rate-limited: not applicable.
- UI bar: Reshuffle is an icon button with a tooltip, not a second primary action.

## Scenario seed packs

- Reuse `ordering` (1,000 cards). Add `shuffle-partial`: 300 cards without `shuffleKey` mixed with keyed cards, to rehearse the pre-backfill state.

## Break-it checklist

- UI: reshuffle ten times fast; back/forward through shuffles; reload mid-scroll; share the URL into another browser; switch shuffle to newest and back.
- Backend: page through all cards and assert no duplicates or gaps across the wrap; seed at the extremes (0, 2^31-1); cards created mid-paging; unkeyed cards; bad `shuffleSeed` (400); API cursor from a different seed (400).

## Tests

- `packages/convex/__tests__/card/listQuery.test.ts`: determinism for a seed; no duplicates across the wrap; unkeyed cards included once.
- `packages/convex/__tests__/card/getCards.test.ts`: shuffle on search and tag paths is deterministic and complete.
- `packages/convex/__tests__/migration/backfillShuffleKey.test.ts`: dry run writes nothing; idempotent rerun.
- `packages/ui/src/lib/__tests__/searchUrlState.test.ts`: `sort=shuffle&seed=` round-trip and invalid seed handling.

## Proof before the PR

- Video: switch to Shuffle, scroll, reload (same order), Reshuffle, back.
- Screenshots: sort menu with Shuffle, Reshuffle button, light and dark, 390px and 1440px.
- Captured two API pages with the same seed and the backfill dry-run report.

## Release gate

1. Narrow tests above, then the repo checks and `02-web-journey.e2e.ts`, `03-api.e2e.ts`.
2. Seed `shuffle-partial`, run the break-it pass, fix and add regression tests.
3. Proof bundle as above.
4. PR, green CI, merge, deploy Convex (index build) then web; run `backfillShuffleKey` dry run, check counts, run the pages; smoke-test shuffle in production.

## Risks And Open Questions

- Native clients do not show shuffle; that is expected in this roadmap (web plus API only).
