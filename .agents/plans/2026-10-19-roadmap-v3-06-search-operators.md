## Goal

Let search exclude and combine:
- `-word`, `-"phrase"`, and `-` before any qualifier (`-tag:x`, `-#x`, `-type:image`, `-site:x`, `-folder:x`, `-is:fav`);
- uppercase `OR` between terms or qualifiers;
- parentheses for grouping.

This works everywhere a search runs: the search box, smart folders, the command palette, the API `q`, MCP and the CLI. Phase 6 of the [roadmap v3](2026-10-19-roadmap-v3-00-roadmap.md).

## Depends on

- Nothing.

## Success Criteria

- **Examples:**
  - `design -figma` finds cards matching "design" that don't contain "figma".
  - `#inspo -type:image` finds tagged cards that aren't images.
  - `tag:fonts OR tag:type` finds cards with either tag.
  - `(site:github.com OR site:gitlab.com) -is:archived` combines both.
- **Precedence:** `-` binds tightest, then implicit AND (a space), then `OR`. Parentheses override; nesting is limited to 4 levels.
- **Forgiving parsing:** unbalanced parentheses, a trailing `OR` or a bare `-` never error. A lone `-` or `OR` with nothing to apply to is ignored. An unclosed `(` closes at the end of the query.
- **Lowercase `or` is an ordinary word.** A `-` inside a word (`to-do`, `e-mail`) or after a qualifier's colon (`price:<-5`) is not an operator.
- **Semantic results:** results matched by meaning are blended in as today, then every exclusion and OR group filters both the keyword and meaning results (owner decision). Excluded words are never embedded.
- **Smart folders:** a smart folder's saved query and the typed search combine as `(folder query) (typed query)`, so an OR in one can't leak into the other.
- **The canonical form** shown in the URL and the search pills keeps operators: `#inspo -type:image`.
- **Teaching:**
  - Typing `-` at the start of a token suggests "Exclude…" with the qualifier keys.
  - The `?` shortcuts sheet gains a "Search" group.
  - The docs' Smart search table gains rows.

## Context And Current Facts

- **Parser:** `packages/convex/shared/search/qualifiers.ts`.
  - `SEARCH_QUALIFIER_KEYS` (lines 8–18): tag, type, is, site, folder, like, mood, price, text.
  - `ParsedSearchQuery` (lines 49–66): flat arrays of terms, phrases, tags, types, sites, folders, prices and ocrTexts, plus flags and canonical.
  - `tokenize` (lines 89–138) splits on whitespace and honours straight and curly quotes and `\` escapes.
  - `parseSearchQuery` (line 316) sorts tokens into those arrays. There is no negation, OR or grouping.
  - `-tag:x` currently becomes the free term `-tag:x`, and `OR` becomes a term.
- **AND/OR inside one kind today:** types and sites already OR within their kind (`resolveSearch` filters `types.includes`, `sites.includes`). Tags, folders, phrases and `text:` AND.
- **Trimmed characters:** `SEARCH_TOKEN_TRIM_CHARACTERS` (`shared/search/constants.ts:43`) is `,.;:!?()[]{}"'`. Parentheses are trimmed from term edges today.
- **Smart folders:** `combineSearchQueries` (`qualifiers.ts:453–500`) intersects types and sites and concatenates the rest. Used by `card/searchPlanner.ts` `expandFolderSearch` (around line 85).
- **Planner:** `card/searchPlanner.ts` `resolveSearch` (line 109).
  - It builds index filters from the flat arrays, plus a card-level `matches(card, searchableText?)` (lines 175–219).
  - `hasCardFilters` (lines 225–235) switches to batch scans.
- **Keyword search:** free words go to the Convex full-text index `cardSearchDocuments.search_searchableText` (`searchDocumentHelpers.ts`).
  - Convex ranks by relevance and doesn't require every word.
  - It is capped by a 4,096-row scan budget, then "Search is too broad. Add a type or date filter." (`searchDocumentHelpers.ts:738–743,792`).
- **Meaning search:** `shared/search/semantic.ts` `semanticQueryText` (lines 22–34) embeds terms and phrases only, and `fuseRankings` fuses the results.
- **Local cache filter:** `shared/search/localSearch.ts` `filterLocalCards` (line 114) requires every term as a substring of `buildSearchableText(card)` (line 240).
- **UI:**
  - Suggestions: `apps/web/src/components/search/searchSuggestions.ts` (`QUALIFIER_HINTS` at line 46, `IS_OPTIONS` at line 57).
  - Shortcut sheet: `apps/web/src/lib/keyboardShortcuts.ts:23` `KEYBOARD_SHORTCUT_GROUPS` (Cards, Open card, Go to, Anywhere), shown by `components/modals/KeyboardShortcutsDialog.tsx`.
- **Docs:** `apps/docs/content/docs/features.mdx:41–75`, the Smart search token table.

## Constraints And Non-goals

- **Keep the flat fields.** `ParsedSearchQuery` keeps its flat fields for the required, top-level, positive parts, so index narrowing stays as fast as today. A new optional `expression` describes the full boolean structure. When the query has no operators, `expression` is undefined and every code path behaves exactly as today.
- **What can't be negated or OR'd:** `like:` and `mood:` cannot be negated or put in an OR group, since they select a different ranking. `-like:` and `-mood:` stay plain words, and a `like:` inside an OR group makes that group a plain-text group. The suggestion list never offers them after `-`.
- **Index candidates:**
  - Words inside OR groups go to the index together with the required words. The index ranks by relevance and doesn't require all of them, and the card-level check then enforces the real logic.
  - Excluded words never go to the index.
  - A query of only exclusions (`-tag:old`) reads by date with the card-level check, bounded by the same scan budget and the same "too broad" error.
- **Word matching at card level:** a lowercase substring match on the card's searchable text, the same rule `localSearch.ts` uses. So `-design` also excludes "designer".
- **Qualifier semantics stay the same inside the expression** as at top level (tags ignore case, `site:` matches the normalized host, and so on).
- **Search syntax stays English** (localization decision in the roadmap).
- **Analytics:** add `search_operator_used { negation, or, groups }` to `shared/analytics.ts` first. It fires once per executed web search that uses an operator.

## Backend

- **`shared/search/qualifiers.ts`:**
  - **`tokenize`** emits `(` and `)` as their own tokens when they are outside quotes and stand at a token's start or end. Inside a word they stay. Every token also gets `negated: boolean`: true for a leading `-` followed by a non-space, outside quotes, when the token isn't just `-`.
  - **New type:**

    ```ts
    SearchExpression =
      | { op: "and" | "or"; items: SearchExpression[] }
      | { op: "not"; item: SearchExpression }
      | { op: "term"; value: string }
      | { op: "phrase"; value: string }
      | { op: "qualifier"; qualifier: SearchQualifier }
    ```
  - **New `parseSearchExpression(tokens)`:** a recursive-descent parser for or → and → unary → primary. Nesting is capped at depth 4 and the expression at 64 leaves; past that the rest is read as plain terms. It never throws.
  - **`parseSearchQuery`:**
    1. Build the expression.
    2. Lift the top-level AND's positive leaves into the existing flat fields.
    3. Set `expression` only when a `not`, an `or` or a parenthesised group remains.
    4. Set `canonical` from the expression printer, and `text` from all positive terms and phrases.
  - **New `formatSearchExpression`:** prints `-x`, `A OR B` and `(…)`. Parentheses appear only where precedence needs them, so `parse(format(x))` is stable.
  - **`combineSearchQueries(scope, typed)`:** when either side has an `expression`, it returns `"(" + scope.canonical + ") (" + typed.canonical + ")"`, normalized through `parseSearchQuery`. Otherwise it keeps today's intersection logic.
- **New `shared/search/expression.ts`:**
  - `matchesExpression(expression, card, searchableText, resolvers)` evaluates against a card. The resolvers check tags, types, sites, folders (resolved ids), `is` flags, price and `text:`, through the same helpers `resolveSearch` uses (`cardHasTag`, `cardUrlHost`, `matchesPriceBounds`, `matchesImageText`, `matchesDoneState`).
  - `expressionIndexTerms(expression)` returns the positive words and phrases for the index and for embedding.
- **`card/searchPlanner.ts` `resolveSearch`:**
  - Resolve the folder names used anywhere in the expression. An unknown folder makes its leaf false, not the whole query empty.
  - `matches` also checks `matchesExpression` when there is an expression.
  - `hasCardFilters` is true when there is an expression.
  - Excluded hidden tags: `-tag:hidden` never reveals hidden cards. `revealsHidden` looks only at positive tags.
- **`shared/search/semantic.ts` `semanticQueryText`:** uses `expressionIndexTerms`, so it never embeds excluded words. Fused meaning results pass through `matches` before they are shown. This already happens for card filters; confirm it covers the blended path in `search/semanticActions.ts` and `ui/src/hooks/useSemanticSearch.ts`.
- **`shared/search/localSearch.ts` `filterLocalCards`:** applies `matchesExpression` with the same resolvers on cached cards.
- **No schema change and no backfill.**

## Web

- **`searchSuggestions.ts`:**
  - When the current token is `-` or starts with `-`, offer a group titled "Exclude". It lists `-tag:`, `-type:`, `-site:`, `-folder:` and `-is:` with the hint "Leave out cards with…", and completes values exactly as the positive qualifiers do: tags, types, sites, folders, and the `is` options.
  - After a complete token followed by a space, typing `O` offers `OR` with the hint "Either side matches".
- **Search pills:** an excluded qualifier renders as a pill with a leading "−" and a line through its label (`aria-label="Excluding tag design"`). The owner didn't choose struck or red pills, so this is a muted visual only, with no flip action.
- **`lib/keyboardShortcuts.ts`:** a "Search" group with these rows:
  - `-word` Exclude a word
  - `-tag:x` Exclude a tag, type, site or folder
  - `a OR b` Either one
  - `( … )` Group
  - `"phrase"` Exact words

  The dialog renders it like the others.
- **Copy for impossible combinations:** a search that can't match (`type:image -type:image`) shows the standard empty search state.

## API / MCP / SDK / CLI

- **No new operation.** `q` on `GET /v1/cards` and `POST /v1/cards/search` (whichever lists it today) accepts the operators.
- **`publicApiOpenApi.ts`:** the `q` description documents the operators.
- **MCP:** the `search_cards` / `teak_v1_search_cards` description lists them.
- **CLI:** the search help string (`apps/cli/src/index.ts`, the qualifiers list around line 185) adds them. In shells, `-tag:x` must follow `--` or sit inside the quoted query; the help shows `teak cards search "design -tag:old"`.
- **SDK:** no change (`q` is a string).

## Docs

- **`features.mdx` Smart search table:** add rows for Exclude (`-figma`, `-"brand guide"`, `-tag:old`, `-type:image`, `-is:archived`), Either (`tag:fonts OR tag:type`) and Group (`(site:github.com OR site:gitlab.com) -is:archived`), plus a note that `or` in lowercase is just a word.
- `(developers)/api.mdx`, `mcp.mdx` and `(apps)/cli.mdx`.
- The month's changelog: "Exclude words and filters with -, and combine them with OR".

## UI states

- **Typing `-`:** the "Exclude" suggestion group appears immediately, in place of the normal suggestions.
- **An unbalanced `(`:** the search runs, with the group closed at the end. The canonical form in the URL shows the closing parenthesis.
- **Only exclusions on a large library:** if the scan budget is hit, the existing "Search is too broad. Add a type or date filter." message.
- **Long expressions:** the pills wrap; past 64 leaves, the rest is searched as words.
- **Empty result:** the standard empty search state.

## Scenario seed packs

- **`search-operators`:** 400 cards, designed so each operator has a distinct answer:
  - "design" with and without "figma";
  - tags `fonts`, `type` and `Fonts` (a case variant);
  - images and links on github.com and gitlab.com, some archived;
  - hidden cards tagged `hidden`;
  - cards in folders "Inbox" and "Reading list";
  - priced products;
  - images with OCR text "total due".
- **Smart folders** with `tag:fonts OR tag:type`, `-is:archived` and `(site:github.com OR site:gitlab.com)`.

## Break-it checklist

- **Each operator alone, and combined:**
  - `-`, `OR` and `()`;
  - `--design`;
  - `- design`;
  - `OR OR`;
  - `(()`;
  - `)design(`;
  - `"-not negated"`;
  - `to-do`;
  - `price:<-5`;
  - `-like:<id>`;
  - `mood:x OR tag:y`.
- **Hidden cards:** `-tag:hidden` must not reveal them. `tag:hidden OR tag:x` reveals hidden cards only through the `tag:hidden` branch.
- **Smart folders:** a smart folder with an OR, plus a typed search with an OR, and the result is the intersection.
- **Other surfaces:**
  - The API `q` with a 1,000-character expression.
  - The CLI with an unquoted `-tag:x` (shows the help hint).
  - MCP search.
- **Semantic blending:** a meaning match containing an excluded word must not appear.
- **Browser:** back and forward through canonical URLs; two tabs.

## Tests

- `packages/convex/__tests__/shared/search/qualifiers.test.ts`:
  - `test.each` over every parse case above;
  - the printer's round-trip (`parse(format(x))`);
  - precedence;
  - caps;
  - never throws (fuzz with random token soup);
  - `combineSearchQueries` with expressions.
- `packages/convex/__tests__/shared/search/expression.test.ts`: evaluation per leaf kind and per operator.
- `packages/convex/__tests__/shared/search/localSearch.test.ts` and `semantic.test.ts` (excluded words are not embedded).
- `packages/convex/searchQualifiers.test.ts` (Vitest):
  - operators across batch pages, archive, trash and hidden;
  - smart folders;
  - the scan-budget error for exclusion-only queries.
- `apps/web/src/components/search/__tests__/searchSuggestions.test.ts`: the Exclude group and `OR`.
- e2e: `packages/tests/src/web/search-operators.e2e.ts` (new), and `journey/03-api.e2e.ts` adds one `q` with operators.

## Proof before the PR

- **Video 1:** type `design -figma`, watch the Exclude suggestions, then `(site:github.com OR site:gitlab.com) -is:archived`.
- **Video 2:** a smart folder `tag:fonts OR tag:type` with a typed `-tag:fonts`.
- **Screenshots:** the suggestions, the excluded pill, and the shortcuts sheet's Search group, in light and dark at 390px and 1440px.
- **Captured requests:** `GET /v1/cards?q=…` with operators, plus `teak cards search` output.

## Release gate

1. Run the narrow tests, the repo checks and the e2e specs.
2. Seed `search-operators`, run the break-it pass, and fix and add regression tests until it is clean.
3. Send the proof bundle to the owner.
4. Merge, deploy Convex and then web, and smoke-test an exclusion search on production.

## Risks And Open Questions

- **Open decision (default: substring matching for words).** `-design` also excludes "designer". It matches today's local search rule; whole-word matching would need a tokenizer shared with the Convex index.
- **Open decision (default: uppercase `OR` only).** Lowercase "or" is too common in natural queries.
- **Open decision (default: no struck or red "NOT" pills).** The owner skipped them. Excluded pills only show a "−".
- **Performance.** Exclusion-only and OR-heavy queries use batch scans. Measure p95 on a 10,000-card library on dev before merging. If it's slow, consider an index-backed path for `-is:archived` and `-type:` (already index fields).
- **Native apps** send search text to the same parser through their Convex queries, so they gain the operators with no UI. Their local filtering, if any, may disagree until they update.
