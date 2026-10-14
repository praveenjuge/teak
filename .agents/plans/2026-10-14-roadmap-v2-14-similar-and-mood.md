## Goal

Find similar cards:
- A `like:<cardId>` qualifier lists the cards closest in meaning to one card. Its chip shows the card's title, and it can be saved in a smart folder.
- A "More like this" button in card details opens that search.
- `mood:"…"` searches images by mood.
- The API (`similarTo`), MCP (`teak_v1_find_similar_cards`) and CLI (`teak similar <id>`) get the same.

The homepage then calls out the new search features. Phase 14 of the [roadmap v2](2026-10-14-roadmap-v2-00-roadmap.md).

## Depends on

- [Phase 13](2026-10-14-roadmap-v2-13-hybrid-search.md): the semantic cache, the fusion helpers, `searchMode` and the fallback rules.
- Through phase 13, [phase 12](2026-10-14-roadmap-v2-12-embeddings.md): `vector-query` with `vectorOfId`, and Vectorize `queryById`.

## Success Criteria

- "More like this" on a brutalist building photo lists other concrete architecture photos and related notes and links, of any type. The card itself is never listed.
- `like:<id> type:link`, `like:<id> #design` and `like:<id> is:archived` narrow the similar set like any qualifier. The sort menu applies. Hidden cards follow phase 4's reveal rule: they never appear unless the query also has `#private`, `#nsfw` or `#hidden`, so `like:<id> #private` shows similar private cards.
- The `like:` chip reads "Similar to: <card title>", which truncates and opens the card on click. For a trashed, deleted or another user's card, or a hidden card in a query without a reveal tag, the chip reads "Similar to: unavailable card" and the grid shows the empty state, never an error.
- A smart folder saved with `like:<id>` keeps working and survives the anchor card being renamed.
- `mood:"moody brutalist"` returns only images, ranked by meaning against their summary, tags, styles and text, then sorted.
- `GET /v1/cards?similarTo=<id>` equals `q=like:<id>`. MCP `teak_v1_find_similar_cards` and `teak similar <id>` return the same cards.
- `features.mdx`, the changelog and the homepage feature showcase describe the new search features.

## Context And Current Facts

- Qualifier keys are `SEARCH_QUALIFIER_KEYS` in `shared/search/qualifiers.ts` (`tag`, `type`, `is`, `site`, `folder`, plus `text` from phase 10).
  - Values are normalized in `parseQualifier`, written back with `formatSearchQualifier`, and merged for smart folders by `combineSearchQueries`.
  - In a merge, types and sites intersect and everything else adds up; `null` means nothing can match.
- Smart folders store `folders.query` and are expanded by `expandFolderSearch` (`card/searchPlanner.ts`) and by `publicApiHttpCards.ts` (folder → `q`).
- Chips are built by `describeQualifierChip` (`packages/ui/src/components/search/searchSuggestions.ts`), which is pure and synchronous, and rendered by `FilterChipButton` in `SearchBar.tsx`.
- The detail panel action list is `CardMetadataPanel.tsx`: Favorite, Download, Notes, Tags, Folders, Refresh details, Archive, Delete. It uses `PanelButton` and `lucide-react` icons.
- After phase 12, `vector-query` takes `vectorOfId` (`queryById`) and refuses a vector owned by someone else. Vectorize writes are queryable a few seconds after the upsert.
- After phase 13:
  - `requestSemanticResults` fills `semanticSearchResults`, and `searchCardsPaginatedHandler` and `searchCardsPageForUser` fuse from the cache.
  - `shouldRunSemantic` skips searches made only of qualifiers.
- The MCP tool list is `TEAK_V1_TOOLS` plus `toolConfigs` in `mcp/tools.ts`. `queryTool` maps tools onto `GET /v1/cards`.
- The CLI has top-level shortcuts next to the `cards` group (`teak ls`, `teak add`, `teak trash`, `teak restore` and others, in `apps/cli/src/index.ts`).
- Homepage: `apps/docs/components/HomeFeatureShowcase.astro`. Its "Search the way you remember" entry lists keywords, types, tags, dates, colors and visual styles, with the image `/home-showcase/search-mac.webp`.

## Constraints And Non-goals

- **One similarity anchor per search.**
  - Either one `like:` or one `mood:`. Writing a second one is kept as plain text.
  - In a smart folder, `combineSearchQueries` returns `null` (nothing matches) when the folder and the typed text name two different anchors, and keeps a single anchor when only one side has it.
- **`like:<id>`.**
  - The value must look like a Convex id. Anything else is plain text.
  - The server re-checks the anchor's owner, Trash and hidden state on every read.
  - The anchor card is excluded. Its semantic rank comes from `vector-query { vectorOfId, topK: 100 }` with no score threshold, because the list *is* the similar set.
  - Keyword words in the same search filter the similar set (AND). They do not fuse.
- **`mood:"…"`.**
  - The text is embedded and filtered to `types: ["image"]`, with the phase 13 threshold.
  - Together with `type:link` it matches nothing, through the existing type intersection.
- **Cache.** Results are cached in `semanticSearchResults` keyed by `like:<id>` or `mood:<text>`. A `like:` entry for an anchor without a vector yet is cached as `pending` for 15 s.
- No visual (pixel) embeddings. Mood is matched against the text description of an image, its `visualStyles` and its OCR text, which phase 12 embeds.

## Backend

- `qualifiers.ts`:
  - `like` and `mood` keys, with `ParsedSearchQuery.similarity?: { kind: "like"; cardId } | { kind: "mood"; text }`.
  - Canonical form is `like:<id>` and `mood:"…"`.
  - Anchor rules in `combineSearchQueries`.
- `search/semantic.ts`: `semanticSearchKey` covers both kinds. `shouldRunSemantic` returns true for any anchor.
- `search/semanticActions.ts` `requestSemanticResults`:
  - For `like`, it first runs an internal query that checks the anchor (owner, not trashed, and not hidden unless the query reveals hidden cards) and then queries by id.
  - For `mood`, it queries by text with image types.
  - States written to the cache: `ok`, `pending` (no vector yet) and `unavailable`.
- `getCards.ts` and `publicApi.ts`:
  - When an anchor is set, the similar set replaces the keyword driver.
  - The other qualifiers filter through `resolved.matches`, and hidden cards use the same `includeHidden` rule as the keyword side (excluded unless a reveal tag is present). Then the sort applies.
  - Cards are capped at 100 per anchor. The API's `match` cursor pages them.
- `card/getCards.ts` `similarAnchorSummary` (query): `{ status: "ok" | "unavailable" | "pending", title? }` for the chip. It never returns another user's title.
- `publicApiHttpCards.ts`:
  - `similarTo` becomes `like:<id>` inside `q` (invalid id returns 400 `INVALID_INPUT`; an unavailable anchor returns 200 with no items and `similarity: "unavailable"`).
  - `searchMode` comes from phase 13.
- `shared/analytics.ts`: client event `similar_search_opened { source: "panel" | "chip" | "url" }`, and `search_performed.search_mode` gains `"similar"`.

## Web

- `CardMetadataPanel.tsx`: a "More like this" `PanelButton` (lucide `Sparkles`) after Folders, hidden in Trash. It closes the modal and opens the library with `?q=like:<id>`, using `searchUrlState.ts` (Back returns to the card).
- `searchSuggestions.ts` `describeQualifierChip`:
  - `like` gets the title "Similar to" and a label from a new `anchorTitle` argument.
  - `mood` gets the title "Mood" and the quoted text as its label.
- `SearchBar.tsx` passes the title from `useQuery(api.cards.similarAnchorSummary)`. Until it loads, the chip shows a 6rem skeleton.
- Empty state for `like:`: "Nothing similar yet". While the anchor's vector is pending: "Still learning about this card. Try again in a moment." with a Retry text button.
- Smart folders: saving the current search keeps `like:` and `mood:`. The folder list shows the chip label, not the raw id.

## API / MCP / SDK / CLI

- `GET /v1/cards?similarTo=<id>` documented in `publicApiOpenApi.ts`, plus `like:` and `mood:` in the `q` description.
- MCP `teak_v1_find_similar_cards { cardId, limit?, type?, sort?, include? }` (`READ_ONLY`), mapped through `queryTool` to `similarTo`. The `q` descriptions list `like:` and `mood:`.
- SDK `cards.similar(id, options)`, and `similarTo` in `qs()`.
- CLI: `teak similar <id>` (top-level shortcut) and `teak cards similar <id>`, with `withListOptions` (`--type`, `--sort`, `--limit`, `--json`).

## Docs

- `features.mdx` "Smart search":
  - A "Find similar" subsection: More like this, `like:`, saving it as a smart folder.
  - A "Search images by mood" subsection: `mood:`.
  - Token table rows for both.
- `(developers)/api.mdx`, `mcp.mdx`, `(apps)/cli.mdx`.
- Ship-month changelog: "Find similar cards".
- `HomeFeatureShowcase.astro`: update the search entry to cover meaning, text in images, find similar and search images by mood. Recapture `search-mac.webp` (1512 × 982 class asset) showing a `like:` chip. Homepage copy needs no changelog entry.

## UI states

- Empty: "Nothing similar yet" (quiet, no illustration).
- Loading: chip skeleton and grid skeletons. A pending vector shows the "Still learning" line.
- One item / many items: 1 similar card; 100 similar cards (the cap), paged with infinite scroll.
- Very long names: a 300-character, emoji or RTL anchor title truncates in the chip with a tooltip and `dir="auto"`.
- Error: an unavailable anchor shows "Similar to: unavailable card" and the empty state. A worker failure shows the empty state plus "Try again" (there is no keyword fallback for an anchor-only search).
- Rate-limited: "Too many searches. Try again in a minute." under the header, using phase 13's `semanticSearch` limit.

## Scenario seed packs

- `similar-cards` on dev, through the real pipeline:
  - Clusters of 15 cards each (concrete architecture, sourdough, TypeScript errors, synthwave palettes) across all 8 types.
  - A card saved seconds ago (vector pending).
  - Anchors that are trashed, hard-deleted or another account's, and hidden anchors with and without `#private`.
  - A library with no images, for `mood:`.
  - A 300-character emoji anchor title.
  - Smart folders saved with `like:` and `mood:`.

## Break-it checklist

- UI:
  - Click More like this twice quickly.
  - Back and forward between the anchor and the results.
  - Remove the chip.
  - Rename the anchor card while its chip is visible.
  - Trash the anchor in another tab.
  - Save as a smart folder, then delete the anchor.
  - Keyboard-only from the panel button.
  - 390px chip truncation; light and dark.
- Backend:
  - `like:` with another user's id leaks no title and no results.
  - `like:` with a malformed id becomes plain text.
  - Two anchors in one search.
  - `mood:` with `type:link`.
  - `similarTo` plus `q=like:` with a different id.
  - A pending vector.
  - Hidden results excluded without a reveal tag and included with `#private`.
  - API paging across the 100-card cap.
  - Rate limit.

## Tests

- `packages/convex/__tests__/shared/search/qualifiers.test.ts`: `like` and `mood` parsing, id validation, canonical form, anchor rules in `combineSearchQueries`.
- `packages/convex/similarSearch.test.ts` (new convex-test file, added to `vitest.config.ts`):
  - seeded cache rows give the anchor excluded, filters applied, hidden excluded unless revealed and sorts applied
  - an unavailable anchor
  - another user's anchor
  - `similarAnchorSummary` privacy
- `packages/convex/__tests__/search/semanticActions.test.ts`: `like` routes to `vectorOfId`, `mood` to image types, the pending state (worker mocked).
- `packages/convex/__tests__/publicApiHttpCards.test.ts`: `similarTo` mapping, 400 on a bad id, `similarity: "unavailable"`.
- `packages/convex/__tests__/mcp.test.ts`: `teak_v1_find_similar_cards` schema and mapping. `__tests__/sdk.test.ts`: `cards.similar`. `apps/cli/src/commands.test.ts`: `teak similar`.
- `packages/ui/src/components/search/__tests__/searchSuggestions.test.ts`: chip labels. `packages/ui/src/components/card-modal/__tests__/CardMetadataPanel.test.tsx`: the button is shown, and hidden in Trash.
- `packages/tests/src/web/search-qualifiers.e2e.ts`: More like this opens `?q=like:<id>` with the chip titled by the card. Locally there are no vectors, so the "Nothing similar yet" empty state appears. Back returns to the card.
- `packages/tests/src/docs/pages.e2e.ts`: the homepage search entry renders its new copy.

## Proof before the PR

- Video 1: open a concrete-building photo, click More like this, narrow with `type:link`, save it as a smart folder, and reopen it.
- Video 2: the nastiest case. Trash the anchor in a second tab, watch the chip turn "unavailable", then try `mood:"moody brutalist"` on a library with no images.
- Screenshots of the panel button, the chip (normal, long, unavailable, loading), the empty and pending states, and the homepage entry: light and dark, 390px and 1440px.
- Captured `GET /v1/cards?similarTo=…`, MCP `teak_v1_find_similar_cards` output, and `teak similar <id>` (plain and `--json`).

## Release gate

1. The narrow tests above, then the repo checks and `03-api`, `04-cli`, `05-mcp`, `search-qualifiers.e2e.ts` and the docs e2e. Break the anchor exclusion and the ownership check on purpose and confirm the tests fail.
2. Seed `similar-cards`, run the break-it pass, then fix and add regression tests.
3. Send the proof bundle.
4. PR, green CI, merge. Deploy Convex, then web, then docs. No worker change and no backfill. Smoke-test in production: More like this on a test card, `teak similar`, and the homepage entry.

## Risks And Open Questions

- **Naming.** The qualifier is `mood:` (owner decision). Keep that word on every surface: docs, MCP and CLI help, suggestions and the chip title "Mood".
- **Mood is text-based.** Embeddings are text-only, so mood quality depends on the image summaries and `visualStyles`. Whether pure visual embeddings are worth a later phase is an open question.
- **Leaking ids.** A smart folder whose anchor is later hard-deleted shows "unavailable card" forever. Should the folder offer to remove the anchor?
- **Pending window.** Vectorize writes become queryable after a delay, so a card saved seconds ago shows the pending state. The 15 s pending cache keeps retries cheap.
