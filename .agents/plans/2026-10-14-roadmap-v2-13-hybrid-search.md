## Goal

Blend semantic matches into normal search everywhere. A search runs the keyword index and a Vectorize query, merges them with reciprocal rank fusion (RRF), drops weak semantic matches, applies every qualifier and filter, and then applies the chosen sort (newest, oldest or shuffle). The API gains `mode=hybrid|keyword|semantic` (default `hybrid`). Phase 13 of the [roadmap v2](2026-10-14-roadmap-v2-00-roadmap.md).

## Depends on

- [Phase 12](2026-10-14-roadmap-v2-12-embeddings.md): vectors and `vector-query`.
- [Phase 4](2026-10-14-roadmap-v2-04-hidden-cards.md): `isHidden` and its `includeHidden` reveal rule, which the semantic side follows exactly like the keyword side.

## Success Criteria

- Searching `cozy reading nook` finds a photo summarized as "armchair by a window with books", even though no keyword matches. Typos (`typograhpy`) and cross-language queries (`猫` for cat photos) find related cards. Exact keyword hits are still found.
- Keyword results appear as fast as today. Semantic matches merge in when they arrive (target p95 under 700 ms on dev), with no layout jump.
- Every view behaves the same: Trash, Archive, favorites, folders, smart folders, tags, types and visual filters all hold, and hidden cards come from the semantic side only when the search reveals them (`#private`, `#nsfw`, `#hidden`), exactly as on the keyword side.
- `GET /v1/cards?q=…` blends by default, so the MCP tools, the SDK, the CLI and Raycast (which calls the API) all blend too. `mode=keyword` gives today's results exactly. Responses carry `searchMode`.
- If the vector service is down, slow (over 1.5 s) or rate-limited, search quietly falls back to keyword results and reports `searchMode: "keyword"`.

## Context And Current Facts

- Convex queries cannot call the worker. Only actions and httpActions can, and `callFilesWorkerJson` runs in both because it is not `"use node"`. So the semantic leg has to run in an action, while the grid stays a reactive query.
- Web grid:
  - `CardsScreen.tsx` uses `usePaginatedQuery(api.cards.searchCardsPaginated, queryArgs)`, after `REMOTE_SEARCH_DEBOUNCE_MS` in `useCardsSearchController.ts`.
  - `searchCardsPaginatedHandler` (`card/getCards.ts`) reads up to `SEARCH_PAGE_CANDIDATE_LIMIT = 401` candidates through `searchCardsByDocument`, filters them with `resolved.matches`, then sorts with `compareCardsByCreatedAt` or `shuffleBySeed`. Pages are cut from that set using an offset cursor.
- Mobile: `searchMobileCardSummariesPaginated` (`card/mobileCardSummaries.ts`) is a public **query** that the Apple (`CardPager.swift`) and Android (`CardPager.kt`) apps subscribe to directly. It wraps the same handler.
- Public API:
  - `GET /v1/cards` is an httpAction (`publicApiHttpCards.ts`). With `q` or `tag` it calls `internal.publicApi.searchCardsPageForUser`; with shuffle, `shuffleCardsPageForUser`.
  - `searchCardsByQuery` in `publicApi.ts` caps candidates at `MAX_QUERY_SCAN = 400` and pages them with `match` cursors (`createdAt` and id anchors).
  - Smart folders are merged into `q` with `combineSearchQueries` before the call.
- Raycast's search calls `GET /v1/cards` (`apps/raycast/src`, `searchCards`). `raycast.ts searchCardsForUser` is only called from tests.
- MCP `teak_v1_search_cards`, `teak_v1_list_cards` and `search` all forward to `GET /v1/cards` (`queryTool` in `mcp/tools.ts`). The SDK builds the query in `qs()` (`client/sdk.ts`). The CLI has `--sort` and `--seed` in `withListOptions` (`apps/cli/src/index.ts`).
- Rate limits live in `shared/rateLimits.ts` (`publicApiRequests` 120/min). The client event `search_performed { zero_result }` is in `shared/analytics.ts`.

## Constraints And Non-goals

- **When it runs.** The semantic leg runs only when the search has free words (`parsed.text`, terms and phrases) of at least 2 characters. Searches with only qualifiers (`tag:`, `type:`, `site:`, `folder:`, `is:`, `text:`, color and date words) stay keyword-only and make no worker call. `text:` stays OCR-keyword only.
- **Fusion.**
  - Keyword rank is the order Convex search returns. Semantic rank is the Vectorize score order (`topK` 100).
  - `rrf = Σ 1 / (60 + rank)`.
  - Semantic matches below `SEMANTIC_MIN_SCORE` are dropped (start at 0.5 cosine and tune on dev) unless the card is also a keyword match.
  - The fused set is capped at the existing candidate limits (401 grid, 400 API), then filtered by `resolved.matches` / `matchesStructuredFilters`. Semantic candidates use the same `includeHidden` rule as the keyword side: hidden cards are dropped unless `resolveSearch` set `includeHidden` because the tags reveal them. Then the set is sorted.
  - With newest, oldest or shuffle sorts, fusion decides which cards are in the set, not their order. A relevance sort is not added.
- **Semantic cache.** Every surface writes to and reads from one cache table:
  - `semanticSearchResults { userId, key, ranking: [{ cardId, score }] (≤ 100), createdAt, expiresAt }`, with `by_userId_and_key` and `by_expiresAt`.
  - `key` is a SHA-256 of the normalized free text, `EMBED_TEXT_VERSION` and the sorted type filter.
  - Each entry lives for 10 minutes. A bounded cron removes expired rows, and account deletion's `ancillaryPage` removes them by user.
  - Queries only read the cache, so they stay deterministic and reactive. Card state is filtered live.
- New args are optional; old clients get today's behavior. No feature flag.
- Out of scope: a relevance sort, a query-suggestion UI, and changes to `raycast.ts` internals.

## Backend

- `search/semantic.ts`:
  - pure `semanticSearchKey()`
  - `fuseRankings(keyword, semantic, { minScore, k: 60, limit })`
  - `shouldRunSemantic(parsed)`
- `search/semanticActions.ts`:
  - `requestSemanticResults` (public `action`, session auth): checks `shouldRunSemantic` and the new `semanticSearch` rate limit (60/min per user, in `shared/rateLimits.ts`); returns at once on a cache hit; otherwise calls `vector-query { userId, text, topK: 100, types }` and writes the cache.
  - `fetchSemanticRanking(ctx, userId, parsed, types)`: a shared helper for httpActions, with a 1.5 s timeout. On failure it returns `null`.
- `getCards.ts` `searchCardsPaginatedHandler`:
  - takes `mode?: "hybrid" | "keyword" | "semantic"`
  - reads the cache row for `(user, key)`
  - fuses the semantic card ids (loaded with `ctx.db.get`, checked by owner and by `resolved.matches`) with the keyword candidates
  - Everything after that (sort, offset paging, URL attachment) is unchanged.
  - When the cache row appears, the reactive query re-runs by itself, so the args never change and pagination does not reset.
- `mobileCardSummaries.ts`: gets the same optional `mode`, and reads the cache. See Risks.
- `publicApi.ts`:
  - `searchCardsPageForUser` and `shuffleCardsPageForUser` take `semanticRanking?: { cardId, score }[]` (≤ 100) and `mode`.
  - `searchCardsByQuery` fuses before `sortCards`.
  - `match` cursors still work because the candidate set is fixed for a given cache entry.
- `publicApiHttpCards.ts`:
  - parse `mode` and reject unknown values with 400 `INVALID_INPUT`
  - call `fetchSemanticRanking` (cache first) before `runQuery`
  - add `searchMode` to the JSON
  - The cursor binds to its ranking. Page 1 stores the fused candidate ids in a `searchSessions { userId, id, cardIds (≤ 500), mode, createdAt, expiresAt (1 hour) }` row and puts its id in every `match` cursor. Later pages read that frozen list, apply live card state (trash, archive, hidden) and page from the anchor, so cards are never skipped or repeated.
  - If the session row has expired, the API returns `400 CURSOR_EXPIRED` instead of silently switching to a keyword-only set. The SDK and MCP pass that error through to the caller unchanged. They take one cursor per stateless request, so restarting at page 1 on their own would hand back cards the caller already has as if they were the next page. The caller decides whether to discard what it has accumulated and restart. Only the CLI's stateful `--all` loop restarts the whole listing itself: it drops what it has collected, starts again from page 1 and prints a one-line notice.
  - `searchSessions` gets a bounded cleanup cron and is covered by account deletion's `ancillaryPage`.
- `shared/analytics.ts`: add `search_performed.search_mode` and `semantic_merged?: boolean`, plus a server event `semantic_search { outcome: "ok" | "fallback" | "rate_limited", duration_ms }`.

## Web

- `useCardsSearchController.ts`: when the debounced query has free words, call `useAction(api.search.semanticActions.requestSemanticResults)` in parallel with the grid query. The response is not used, because the query picks the results up from the cache. Ignore results from an older query.
- `CardsScreen.tsx`:
  - Keyword cards render as today.
  - Cards that arrive from the semantic side fade in (150 ms ease-out).
  - A one-line muted hint, "Including related cards", appears under the header when a merged card is shown, and is dismissible.
  - When semantic search is unavailable, nothing is shown.
- `ViewMenu.tsx`: no new entry. Sort applies as today.

## API / MCP / SDK / CLI

- `GET /v1/cards`: `mode` (default `hybrid`). The response gets `searchMode` (additive). Document both in `publicApiOpenApi.ts`.
- MCP: `cardFilterProperties.mode` (`hybrid`, `keyword` or `semantic`) on the list and search tools. The `teak_v1_search_cards` description says results include related cards by meaning. The `search` connector tool uses hybrid.
- SDK: `mode` in the `qs()` input and the list and search input types, plus `searchMode` on the page type.
- CLI: `--mode <mode>` in `withListOptions`. `--json` includes `searchMode`, and plain output prints `mode: keyword` to stderr when the search fell back.

## Docs

- `features.mdx` "Smart search":
  - "Search finds cards by meaning, not just exact words"
  - a short example
  - a note that tokens and filters still apply
- `(developers)/api.mdx`: `mode` and `searchMode`. Also `mcp.mdx` and `(apps)/cli.mdx`.
- Ship-month changelog: "Search understands what you mean".

## UI states

- Empty: when neither leg matches, the usual "No cards found" appears, and it waits for the semantic answer or its 1.5 s timeout before showing.
- Loading: the grid shows skeletons until the keyword page lands. No spinner for the semantic leg.
- One item / many items: a single semantic-only match shows the hint. With 401 candidates, paging is unchanged.
- Very long queries: semantic text is cut to 512 characters, and the chip and field are unchanged.
- Error: the worker being down or slow gives keyword results only, with no message.
- Rate-limited: past 60 searches a minute, results are keyword-only. Log the event and show nothing.

## Scenario seed packs

- `hybrid-search` on dev, run through the real pipeline:
  - 60 cards that match only by meaning, paired with queries
  - 60 that match only by keyword
  - 20 that match neither (decoys)
  - typo queries, CJK and Spanish queries
  - a 400-character query
  - filters that exclude everything
- A second account with near-identical cards, for leak checks.
- Hidden, trashed and archived cards that match by meaning.
- Plus the v1 volume and ugly-data packs.

## Break-it checklist

- UI:
  - Type fast, then clear the field; back and forward between searches; reload while the semantic leg is in flight.
  - Two tabs with different queries.
  - Shuffle with a semantic merge (the seed stays stable); oldest sort.
  - Smart folder plus a typed query.
  - Offline and reconnect; slow 3G.
  - 390px and 1440px, light and dark.
- Backend:
  - Another user's cards never appear.
  - Hidden cards never come from the semantic side without a reveal tag. With one, a hidden card that matches only by meaning is returned: `#private cozy reading nook` finds a private card titled "Window seat".
  - Trash only shows trashed cards.
  - A cache entry expires between API pages: later pages still use the frozen session, so nothing is skipped or repeated.
  - A session expires between pages: `400 CURSOR_EXPIRED` reaches SDK and MCP callers unchanged (no silent restart, no repeated cards), and `teak cards search --all` restarts the whole listing once with a notice.
  - Cards created or deleted between pages are neither duplicated nor skipped.
  - `mode=bogus` returns 400.
  - Worker 429 and timeout fall back to keyword results.
  - The rate limit is hit.
  - `mode=keyword` returns exactly today's results (snapshot test).

## Tests

- `packages/convex/__tests__/search/semantic.test.ts`: fusion table tests, threshold, ties, cap, `shouldRunSemantic` for qualifier-only and short queries.
- `packages/convex/hybridSearch.test.ts` (new convex-test file, added to `vitest.config.ts`):
  - seeded cache rows merged into `searchCardsPaginated`
  - filters, hidden, trash, ownership
  - each sort
  - `mode=keyword` matches the old output
- `packages/convex/__tests__/publicApiHttpCards.test.ts`: `mode` parsing, `searchMode`, fallback when the mocked worker throws, paging across an expired cache entry (same frozen set), an expired session (`CURSOR_EXPIRED`), and inserts and deletes between pages (no skips or duplicates).
- `packages/convex/__tests__/mcp.test.ts`, `__tests__/sdk.test.ts` and `apps/cli/src/commands.test.ts`: `mode` is passed through.
- `packages/convex/__tests__/card/mobileCardSummaries.test.ts`: reads the cache; old args are unchanged.
- `packages/ui/src/hooks/__tests__/useCardsSearchController.test.ts`: the action runs only for free text and stale answers are ignored.
- `packages/tests/src/web/search-qualifiers.e2e.ts`: keyword search still works and shows no hint when the local stack has no worker (the fallback path).
- `packages/tests/src/journey/03-api.e2e.ts`: `mode=keyword` and `searchMode`.

## Proof before the PR

- Video 1: on dev, search `cozy reading nook` and watch the photo merge in. Then switch to oldest, then Shuffle.
- Video 2: the nastiest case, a smart folder plus a typed query plus Trash, with a hidden match that must not appear, then the same query with `#private` added, where it must appear.
- Screenshots of the grid with the hint, the empty state and the fallback: light and dark, 390px and 1440px.
- Captured `GET /v1/cards?q=…` with each mode, the MCP `teak_v1_search_cards` output, `teak cards search "cozy reading nook" --mode semantic`, and a p50/p95 latency table from dev.

## Release gate

1. The narrow tests above, then the repo checks and `03-api`, `04-cli`, `05-mcp` and `search-qualifiers.e2e.ts`. Break the fusion and the hidden filter on purpose and confirm the tests fail.
2. Seed `hybrid-search`, run the break-it pass, then fix and add regression tests.
3. Measure p95 latency and the Workers AI and Vectorize cost per 1,000 searches on dev, and record them in the PR.
4. Send the proof bundle.
5. PR, green CI, merge. Deploy Convex (the cache table and cron), then web. There is no worker change or backfill. Smoke-test in production: one semantic-only query on a test account, `mode=keyword`, and the CLI.

## Risks And Open Questions

- **Contradiction.** The master plan says mobile summaries blend automatically. They cannot without an app update: native apps subscribe to a query, and a query cannot call Vectorize. Native apps benefit only once they call `requestSemanticResults` (phases 29 and 31). Until then they get keyword results, plus any cache rows the same user's web searches left behind.
- **Contradiction.** The master plan and the approved plan list `raycast.ts` as a caller to change. Raycast uses `GET /v1/cards`, so it inherits blending from the API. `raycast.ts` is unchanged.
- **Semantic-only noise.** Semantic-only results can feel random with newest or oldest sorts, because rank is not visible. Tune `SEMANTIC_MIN_SCORE` on the seeded pairs, and treat it as an open question whether to add a "Best match" sort later.
- **Cost.** Every distinct free-text search costs one embedding and one Vectorize query. The cache and the debounce bound it, and the 60/min limit caps abuse.
