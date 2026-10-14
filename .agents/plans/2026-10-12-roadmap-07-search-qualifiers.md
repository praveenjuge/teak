## Goal

Add search qualifiers (`tag:` / `#tag`, `type:`, `is:fav`, `is:archived`, `site:`, `folder:`, quoted values) with one shared parser, a query planner that picks the most selective index, and an autocomplete that turns qualifiers into chips. Phase 7 of the [roadmap](2026-10-12-roadmap-00-roadmap.md).

## Depends on

- [Phase 5](2026-10-12-roadmap-05-folders.md) (`folder:` and `folderCards` driver) and [Phase 6](2026-10-12-roadmap-06-tags-sidebar-management.md) (tag snapshot for autocomplete).

## Success Criteria

- `tag:design type:link site:github.com "design system"` returns exactly the matching cards on web, API and MCP, in the requested sort.
- `site:www.example.com`, `site:EXAMPLE.com` and a unicode host match the same normalized host.
- The search box suggests qualifiers, tags, folders and top sites as you type; accepted qualifiers render as removable chips; the URL holds the canonical query string.
- Each qualifier combination reads one index as the driver and filters the rest, staying inside the existing scan budgets.

## Context And Current Facts

- `packages/convex/shared/search/tokenization.ts` exports `normalizeSearchToken`, `tokenizeSearchInput` and `classifySearchToken` (`style | hue | hex | keyword`). `SEARCH_TOKEN_TRIM_CHARACTERS` (`shared/search/constants.ts`) strips `,.;:!?()[]{}"'` from token edges, so quoted values and a trailing `:` are lost today; the new parser tokenizes before that trimming.
- `#` already means a hex color: `classifySearchToken` sends `#3B82F6` (and three-digit forms such as `#fff` or `#bad`) to `normalizeHexColor`. `#tag` must lose to a valid hex, or hex-shaped tags need `tag:`.
- `searchCardsByExactTag` (`card/searchDocumentHelpers.ts:533`) already supports `sort`, `type`, `isFavorited`, date bounds, a scan budget and a `resultFilter`, but only the public API (`?tag=`) uses it; the web search path calls `searchCardsByDocument` only.
- `resolveQuickSearchCommand` handles bare `fav` and `trash`; `is:fav` and `is:archived` replace them as the canonical form while the bare words keep working.
- `SearchBar.tsx` (358 lines) renders keyword pills and exposes the declarative WebMCP form `toolname: "teak_search_form"`; that contract must keep working.
- There is no host field on cards. Host logic exists privately in `shared/utils/linkCategoryResolver.ts` (`stripSubdomains`, `hostnameMatches`); a shared `normalizeUrlHost` should live in `shared/utils/`.

## Constraints And Non-goals

- New Convex args are optional; the mobile summaries query keeps its shape and simply accepts qualifier text inside `searchQuery`.
- `cards.urlHost` is written through `patchCardWithSearchSync` (add `urlHost` to its `searchableFields`) and mirrored on `cardSearchDocuments`.
- New index `by_user_deleted_archived_host_created` beside the old ones.
- Backfill `migration/backfillUrlHost.ts`: dry run by default, cursor-paged, bounded batches, self-scheduling, following `operationalRetention.ts`.
- One parser for web, API and (Phase 8) smart folders; the server re-parses and never trusts client-side chips.
- No source filter (dropped).

## Backend

- `shared/search/tokenization.ts parseSearchQuery(text)` → `{ terms, tags[], types[], favorite?, archived?, sites[], folders[], styles, hues, hexes, canonical }`, case-insensitive keys, quoted values, unknown qualifiers kept as terms. `#value` is a tag unless it parses as a hex color.
- `schema.ts`: `cards.urlHost?`, `cardSearchDocuments.urlHost?` and a `urlHost` search filter field; `cards.by_user_deleted_archived_host_created`.
- `card/searchPlanner.ts planSearch(parsed)`: driver order folder rows (`folderCards`) → exact tag (`searchCardsByExactTag`) → host index → full-text (`searchCardsByDocument`) → plain list (`buildCardListQuery`); all other qualifiers become a `resultFilter`.
- `listTopSites` query: top hosts by count from a bounded read (snapshot like tags if needed).
- `migration/backfillUrlHost.ts`: sets `urlHost` for link cards with a `url`.

## Web

- `search/SearchBar.tsx`: Popover + Command autocomplete (from Phase 4) for qualifier keys, tags, folders and sites; Enter accepts; Backspace on an empty input removes the last chip.
- Qualifiers render as chips with the qualifier label ("Site github.com"); the canonical string goes to `?q=` via `searchUrlState`.
- `useCardsSearchController` uses `parseSearchQuery` for local filtering too.

## API / MCP / SDK / CLI

- `GET /v1/cards?q=` accepts qualifiers; existing `tag`, `type`, `favorited` params still work and merge with them.
- MCP `teak_v1_search_cards` description lists the grammar; CLI `teak search 'site:github.com tag:design'`.

## Docs

- `features.mdx` "Smart search": extend the token table with `tag:`, `#tag`, `type:`, `is:fav`, `is:archived`, `site:`, `folder:` and quoted phrases.
- `(developers)/api.mdx` "Search and favorites" and `mcp.mdx`.
- Ship-month changelog: "Search with qualifiers".

## UI states

- Empty: no suggestions when nothing matches; the list hides rather than showing "No results".
- Loading: suggestions from cached tag, folder and site lists appear instantly; remote results use the skeleton grid.
- One item / many items: at most eight suggestions per group; chips wrap to a second line, then scroll.
- Very long names: chips truncate at a max width with a tooltip.
- Error: an unknown `folder:` name shows a muted "No folder named …" chip state and returns no cards.
- Rate-limited: not applicable.
- UI bar: chips reuse the existing pill style; suggestions keyboard-navigable; Esc closes the popover, not the page.

## Scenario seed packs

- `search-qualifiers`: links on 30 hosts including `www.` variants, a unicode host and an IP; tags with case variants and hex-shaped names (`#fff`); folders with spaces and quotes in names; archived and favorite mixes; 1,000-card volume for planner budgets.

## Break-it checklist

- UI: paste a long qualifier string; type fast while suggestions load; back/forward through chip states; remove chips with keyboard only; 390px chip overflow.
- Backend: grammar fuzz (unbalanced quotes, `tag:` with no value, repeated keys, `site:` with a path or port, emoji); every planner driver path; scan budget exhaustion returns partial pages without errors; another user's folder name; archived cards only with `is:archived`.

## Tests

- `packages/convex/__tests__/shared/search/tokenization.test.ts`: `test.each` grammar table incl. quotes, hex vs `#tag`, unknown qualifiers.
- `packages/convex/__tests__/card/searchPlanner.test.ts`: driver choice per combination and correct results for each path.
- `packages/convex/__tests__/migration/backfillUrlHost.test.ts`: dry run writes nothing; pages resume from the cursor.
- `packages/ui/src/hooks/__tests__/useCardsSearchController.test.ts`: qualifiers become chips; canonical string.
- `packages/tests/src/web/search-qualifiers.e2e.ts`: autocomplete, chips, URL round-trip.

## Proof before the PR

- Video: type `site:` and pick a host, add `tag:` from suggestions, add a quoted phrase, remove a chip, reload.
- Screenshots: suggestion groups, chips, no-match state, long chips at 390px; light and dark; 390px and 1440px.
- Captured `GET /v1/cards?q=site:github.com%20tag:design`, MCP search output, `teak search` output, backfill dry-run report.

## Release gate

1. Narrow tests above, then the repo checks and `search-qualifiers.e2e.ts`, `02-web-journey.e2e.ts`, `03-api.e2e.ts`, `11-quote-favorites-filters.e2e.ts`.
2. Seed `search-qualifiers`, run the break-it pass, fix and add regression tests.
3. Proof bundle as above.
4. PR, green CI, merge, deploy Convex (index and search index rebuild) then web; run `backfillUrlHost` dry run, check the counts, then run the pages; smoke-test `site:` in production.

## Risks And Open Questions

- Hex-shaped tags (`#bad`, `#fff`) resolve to colors; is `tag:bad` enough, or should a tag that exists win? Proposed: hex wins, autocomplete offers `tag:` for clashes.
- `site:` matching subdomains: proposed `site:example.com` matches `blog.example.com` too, via a host-suffix filter on the driver.

## As built

- **Parser:** `parseSearchQuery` lives in `packages/convex/shared/search/qualifiers.ts` (not `tokenization.ts`), beside `formatSearchQualifier` and `matchesSearchPhrases`. It tokenizes before punctuation trimming, so quoted values (`folder:"Reading list"`, `\"` escapes, smart quotes, an unbalanced quote running to the end) survive. It returns `qualifiers`, `terms`, `phrases`, `text` (words plus phrase words for the full-text index), `tags`, `types`, `favorite`, `archived`, `sites`, `folders` and `canonical` (qualifiers first, then phrases, then words). Styles, hues and hexes stay with the existing token classifier; a valid hex after `#` stays a word (a color), anything else after `#` is a tag.
- **Hosts:** `shared/utils/urlHost.ts` (`normalizeUrlHost`, `hostForDisplay` with a small punycode decoder). **`site:` matches the exact host** (lowercase, no `www.`, port or trailing dot, punycode): the plan's open question resolved against subdomain matching, which would have needed a reversed-host index. `cards.urlHost` and `cardSearchDocuments.urlHost` (a search filter field) are written alongside `url` by every write path (`withUrlHost` on patches, set at insert) and repaired by `syncCardSearchDocumentHandler`, the choke point every card write passes through.
- **Planner:** `card/searchPlanner.ts` `resolveSearch` merges a parsed search into the view (`type:` narrows the view's types, `is:fav`, `is:archived` reads Archive or the archived cards in Trash, `folder:` names resolve through `by_userId_and_nameKey`, skipping folders being deleted) and returns one `matches(card)` for everything a card can answer. `searchCardsPaginatedHandler` keeps its drivers: text → full-text (one site narrows the search index), then tag rows, then folder rows, then the new host index (`buildHostCardListQuery`, `by_user_deleted_archived_host_created`), then the plain list; card-level qualifiers filter 200-row batches like the folder views. Bare `fav`/`trash` quick commands still work and turn off when any qualifier is present.
- **API/MCP/CLI:** the HTTP layer parses `q` and passes structured args (`tags`, `sites`, `phrases`, `folderNames`, `archivedInTrash`) to the internal queries; contradictions with the plain parameters (`?type=link&q=type:image`) return an empty page. MCP and CLI go through `GET /v1/cards`, so they needed only descriptions and help text. `listTopSites` counts the 500 most recent links.
- **Web:** qualifier chips are stored canonically in `CardsSearchState.qualifierChips` and sent as part of `searchQuery`; the server re-parses. `?q=` round-trips through `cardsSearchStateFromQuery`, and URL comparisons use the canonical form. Suggestions are an inline ARIA combobox in `SearchBar` (no new dependency) fed by `CardsSearchHeader`, which subscribes to tags, folders and top sites only after first focus so their updates re-render the header, not the grid. Local filtering (`filterLocalCards`) applies the same qualifiers; `folder:` searches skip local hits.
- **Seed packs:** `search-qualifiers` (30 hosts in every spelling, case and hex-shaped tags, four awkward folders, favorite/archived/trashed mix) and `search-qualifiers-1000` (five pages; nine in ten links on one host).
- **Backfill:** `migration/backfillUrlHost:backfillUrlHost`, dry run by default, 100 cards per batch (max 200), self-scheduling with running totals, logging `backfillUrlHost finished` at the end.
- **Tests:** `__tests__/shared/search/qualifiers.test.ts` (grammar table), `__tests__/shared/utils/urlHost.test.ts`, `searchQualifiers.test.ts` (convex-test: every driver path, API internals, backfill, top sites) instead of `__tests__/card/searchPlanner.test.ts`, HTTP tests in `publicApiHttpCards.test.ts`, UI tests for the controller, suggestions and SearchBar interactions, and `packages/tests/src/web/search-qualifiers.e2e.ts`. The search box is now a `combobox`, so e2e specs find it by that role.
- **Review fixes:** escaped quotes and backslashes round-trip in phrase and qualifier chips; values with edge punctuation are quoted; `site:` keeps an IPv6 host's brackets; a hex color after `#` keeps Enter for the color filter while a bare `#` picks the top tag; an unknown `folder=` is a 404 before any contradiction shortcut; a lone `site:` reads the requested page size from the host index. Filtered scans (a site with a type, or a tag or folder with colors) still return up to one 200-row batch per page, like the folder views; capping them needs a cursor that stops mid-batch and was left for a follow-up.
- **Rollout:** deployed 2026-10-14. On production the dry run and then the real backfill set `urlHost` on 1,072 cards and their 1,072 search documents; a second dry run over all 2,619 cards found nothing left to update.
- **Break-it fixes:** instant local results joined a card's fields with spaces, so two tags in a row ("design", "systems") matched the phrase `"design system"` on the web but not on the server; phrases now stay inside one field on both. Suggestions ranked by list order put `design-systems` above an exact `design`; an exact name now comes first, then the most used. A reload turned phrase chips back into typed text; phrases now come back as chips. Subscribing to the suggestion lists in `CardsScreen` re-rendered the whole grid when they arrived, which delayed a Settings navigation past the URL write; they now live in `CardsSearchHeader`. `folder:` lookups used `.unique()` on the name index, which a deleted folder sharing the name would break. The `trashed`/`archived` contradiction and `type:` intersection with `?type=` return an empty page instead of ignoring one side. `settings-navigation.e2e.ts` ("preserves home…") fails the same way on `main` and on this branch: unrelated to this phase.
