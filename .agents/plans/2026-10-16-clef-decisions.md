## Goal

Use Cloudflare's Clef decision models on Workers AI for four typed decisions that are rules-only today:

1. **Link category.** Clef picks the category when no domain or path rule matches.
2. **Card type.** Clef decides text, quote or palette for text-only cards.
3. **Visual styles.** Clef judges each style straight from the image, for images and video thumbnails, over a taxonomy that grows from 13 to 19 styles.
4. **Best match.** A new search sort reranks the top 64 results by relevance to the query.

Clef only. One PR, shipped straight on with no shadow phase or flag.

## Status

The code, tests, docs and both backfills are in PR #721. What remains is in [Release gate](#release-gate):

1. Run `scripts/clef-eval` with a Workers AI token and tune the thresholds.
2. Deploy.
3. Run the backfills.

Delete this plan in the PR after the backfills have run.

## Decisions (from the owner, 2026-10-16)

| Topic | Decision |
| --- | --- |
| Where the logic lives | In the Files Worker and `@teak/files-protocol`: prompts, model calls, answer validation and thresholds. Convex sends the inputs it already has and stores the result, through small call sites. |
| Model | Clef 27B (`@cf/cloudflare/clef`) for link category. Clef-flash (`@cf/cloudflare/clef-flash`) for card type, visual styles and reranking. |
| Thresholds | Conservative until the eval runs: 0.85 for link category, 0.85 for card type, 0.7 per style. |
| AI gate | Same as tags and summaries (`getAiGate`). `user_disabled` and `paused` both fall back to today's rules. |
| Rollout | Ship straight on. No shadow mode, no PostHog flag. |
| Plan | Every plan. No premium gate (`.agents/feature-conventions.md`, "Plans and limits"). |
| Category: when | Only when the rules' answer came from the provider mapping, a keyword or the `other` fallback. Domain and path rules stay final. |
| Category: input | URL, host, title, description, site name, and the JSON-LD `@type` values. |
| Category: low confidence | Keep the rules' answer. Clef never picks `other`. |
| Category: list | Today's 15 categories, independent of phase 18. The list grows with phase 18. |
| Category: existing links | Dry-run backfill. |
| Card type: decisions | Unquoted quotes become quotes. Clef judges palettes. Clef can veto a rule's quote or palette guess, so the card stays text. |
| Card type: user intent | Same as today's rules. Clef may change a text card when confident, as the palette regex does now. A card created as a quote stays a quote. |
| Card type: latency | Acceptable. A card may flip type a moment after saving. |
| Styles: source | Clef judges every style directly. The tag aliases are only the fallback when Clef fails. |
| Styles: cards | Images and video thumbnails. |
| Styles: taxonomy | Add typographic, 3d, flat, geometric, hand-drawn and futuristic (19 in total). |
| Styles: existing cards | Dry-run backfill. |
| Rerank: UX | A new "Best match" sort. It is the default while a search has free words; newest stays one click away. |
| Rerank: surfaces | Web grid (and the extension, through `packages/ui`), plus API, MCP, SDK and CLI. Native apps and Raycast are out of scope. |
| Rerank: depth | The top 64 of the search's own order, in one Clef-flash request. |
| Rerank: waiting | Hold the first paint up to 400 ms. If the scores are late, keep the unscored order for that search and never reshuffle. |
| Rerank: judgement | A `score` rubric from 0 to 3. |
| Rerank: cost guard | One `semanticSearch` token per search (60 uncached searches per minute per user): the rerank takes a token only when the meaning lookup for that search took none. Scores are cached for 10 minutes. Over the limit, results keep the unscored order. |
| Eval data | Made-up, hand-labelled fixtures. No real user content. |
| Delivery | One PR. |

## Depends on

- Nothing on the roadmap. Phase 18 (new categories) can land before or after. `LINK_CATEGORY_DESCRIPTIONS` in `apps/files-worker/src/decisions.ts` is an exhaustive `Record`, so phase 18 fails the typecheck until it describes its categories.

## Success Criteria

**Link category**
- A link to a recipe, film, course or podcast page on a site with no rule gets the right category. Today such a link gets `other` or a keyword guess.
- Domain and path rule results never change.
- When Clef fails or isn't confident, the card gets exactly today's answer.

**Card type**
- `Make it work, then make it fast. — my old teacher`, saved with no quote marks, becomes a quote card.
- A CSS snippet with two hex codes stays text.
- A note saved as text whose whole content is a quoted line of dialogue stays text.
- `#264653 #2a9d8f #e9c46a` is still a palette.
- A palette needs at least one parsed colour, or it stays text.

**Visual styles**
- Image and video cards get up to 4 styles from the 19.
- The `style:` filter matches video cards on the server and in the web's local search.
- An image whose Clef call fails gets today's alias-map styles.

**Best match**
- While a search has free words, the web grid defaults to Best match.
- `GET /v1/cards?q=…&sort=relevance` orders by relevance; MCP, the SDK and the CLI expose the same sort.
- On the eval's search fixtures, nDCG@10 is at least the unscored order's.
- A late or failed rerank never moves cards under the user, and paging never repeats or skips a card.

**All four**
- A user with AI turned off sees today's behaviour.
- Every Clef call is counted in `adminUsage`, with its tokens and cost.

## How It Is Built

### Shared base

- **`packages/files-protocol/src/decisions.ts`** holds:
  - the model ids and input prices
  - `DECISION_VERSIONS` and `DECISION_THRESHOLDS`
  - the text limits
  - the op parameter and result types
  - `read*` validators that Convex runs on every reply; a reply that fails validation counts as no decision
- **Files Worker ops**, in `apps/files-worker/src/decisions.ts`, dispatched in `ops.ts`:
  - `decide-link-category`
  - `decide-card-type`
  - `decide-visual-styles` (for the backfill)
  - `score-relevance`
- **`generate-image-metadata` with `visualStyles: true`** also runs the styles question beside the tags call. A Clef failure leaves `visualStyles` out.
- **What each op does:**
  - Validates every answer against its question: a choice must be one of the criteria; probabilities and scores must be in range.
  - Retries Workers AI capacity errors twice.
  - Returns `{ model, version, usage }` with the decision.
  - Returns a decision only when Clef is confident and disagrees with the rules.
- **Request builders.** Each feature has an exported builder (`build*Request`), which `scripts/clef-eval` reuses.
- **Convex, `ai/decisions.ts`:**
  - `runDecision` checks `isFilesWorkerConfigured` and the AI gate.
  - It calls the op with a 3 s timeout.
  - It records usage through `observeAiGeneration`.
  - It returns `null` on any failure.
- **Telemetry.** Clef prices are in `ai/telemetry.ts`, from the protocol's `CLEF_INPUT_USD_PER_MILLION`.
- **Readiness.** `scripts/check-files-readiness.ts` requires the four new ops, so Convex deploys only after a Worker that serves them.
- **Cleanup.** The unused `ai/schemas.ts` is removed.

### Link category

- **Where it runs:** in `mergeAndSaveHandler` (`workflows/steps/categorization/index.ts`). That is the first point holding both the classification and the JSON-LD, so no workflow step is added or reordered.
- **Inputs.** `workflows/steps/categorization/clef.ts` `reviewLinkCategoryWithClef` sends:
  - the URL
  - the link preview's title, description and site name
  - up to 8 JSON-LD `@type` values (including `@graph` and arrays)
- **Which links:** only those whose `reason` is `provider_mapping`, `heuristic` or `fallback`.
- **Provider facts.** If Clef's category would drop a provider's facts (`providerSupportsCategory`), the rules' category stays.
- **Backfill.**
  - `migration/backfillLinkCategoriesClef.ts` is a dry run by default. It also takes `userId`, `once` and `cursor`.
  - It recomputes the rules and queues links whose stored category is still the rules' guess.
  - Jobs hold 8 cards and run 2 s apart, in `migration/backfillLinkCategoriesClefReview.ts`.
  - The write mutation refuses when any of these changed since the job read the card: the URL, the stored category, or `fetchedAt`. It also refuses while the account is being deleted, and it never writes `other`.
  - Only `category` and `confidence` change; facts and raw data stay.

### Card type

- **Where it runs:** the `classify` action (`workflows/steps/classification.ts`) reviews cards with no URL or file and with content.
- **Before the quote shortcut.** The review runs before the quote-mark heuristic returns, so Clef can veto it.
- **Created quotes.** A card created as a quote (an explicit type, or quoted text at create time) keeps the sticky quote branch and is not reviewed.
- **Palette guard.** A `palette` answer still needs `extractCardColors` to find a colour.
- **For the eval:** `textCardRulesType` is exported for `scripts/clef-eval`.

### Visual styles

- **Taxonomy and clients.**
  - `shared/constants.ts` gains the 6 styles, their labels, search aliases, and `VISUAL_STYLE_CARD_TYPES` (image, video).
  - Raycast's `STYLE_OPTIONS` mirrors the list.
  - The Apple `SharedConstants.json` is regenerated.
- **Metadata step** (`workflows/steps/metadata.ts`) asks the image op for styles on images and video thumbnails, and stores them for both.
  - It falls back to the tag aliases when the reply is missing or invalid.
  - A card with styles but no tags is not completed as "without AI".
- **Filters.** `card/visualFilters.ts` and `shared/search/localSearch.ts` let video cards match `style:`.
- **Backfill.**
  - `migration/backfillVisualStyles.ts` is a dry run by default, with `type`, `userId`, `once` and `cursor`.
  - Jobs hold 16 cards and run 3.2 s apart, in `migration/backfillVisualStylesJob.ts`.
  - The write refuses when the card's image key changed or a style is unknown. An empty Clef answer clears old styles.

### Best match

- **Sort value.** `CardListSort` gains `relevance` (`shared/search/sort.ts`). Without free words it orders like `newest`.
  - `keepsServerOrder` keeps the server's order for Shuffle and Best match in the web's local merge.
- **Ordering** (`shared/search/relevance.ts`):
  - Scored cards come first, highest first. Ties and unscored cards keep the search's own order.
  - The card text Clef sees holds the type, title, site, description, summary, up to 6 tags, notes and 300 characters of body, at most 600 characters.
  - The cache key is a SHA-256 of the prompt version and the search text.
- **Cache table** `searchRelevanceResults`: one row per user and search text, holding per-card `{ cardId, score, cardUpdatedAt }`, for 10 minutes (`search/relevanceCache.ts`).
  - Scores of edited cards are ignored and scored again.
  - Filters don't change a card's score, because Clef judges each card on its own. They only change which cards get scored.
  - `storeScores` drops other users' cards and refuses while the account is being deleted.
  - Expired rows are removed by the hourly `cleanup-semantic-search-cache` cron.
  - Account deletion removes the user's rows (`accountDeletionData.ts`).
- **Scoring** (`search/relevanceActions.ts`): `ensureRelevanceScores` scores only cards without a current score.
  - It takes a `semanticSearch` token unless the meaning lookup just took one (`fetchSemanticRanking` reports `spentToken`).
  - It records usage in `adminUsage`.
  - It is V8 code, so the HTTP API can use it.
- **Grid.**
  - `requestRelevanceScores` takes the grid's own search arguments, reads the grid query's top 64 in unscored order, and scores them.
  - `searchCardsPaginated` takes `useRelevanceScores`.
  - `useRelevanceRanking` (`packages/ui`) keys its request on every search input, holds the query up to `RELEVANCE_HOLD_MS` (400 ms), and decides once per search whether to use the scores.
  - `useCardsSearchController` makes Best match the default while a search has free words, until the person picks an order. The View menu shows Best match only then.
- **API.**
  - `sort=relevance` with `q`: the HTTP handler reads the API's own top 64 candidates (`searchCardsPageForUser` with `relevance: {}`), scores them with a 1.5 s timeout, and passes the scores to the page query.
  - Pages use a `relevance` cursor `{ offset, ranked }`. The first page decides `ranked`; later pages keep it, and their scores are read from the cache (fetched again if expired).
  - A ranked cursor can't continue an unranked listing, or the reverse, and a relevance cursor needs `sort=relevance`.
  - The response carries `relevanceRanked`.
  - MCP, the SDK (`CARD_SORTS`, `CardsPage.relevanceRanked`) and the CLI (`--sort relevance`, `relevance: unranked` on stderr) follow.

## Docs

Updated here:
- `features.mdx`: card type detection, the categorization row, visual styles, and Best match in "Sort and share a search".
- `api.mdx`: `sort=relevance`, a Best match section, and the style list with videos.
- `mcp.mdx` and `cli.mdx`: the sort.
- The October 2026 changelog.

Left to the owner: whether "AI Processing" in the privacy policy should mention that Best match sends card text to Workers AI at search time. Today it lists only processing at save time.

## Eval

`scripts/clef-eval/run.ts --feature <link-category|card-type|visual-styles|relevance> [--model clef|clef-flash]` reuses the worker's request builders through the Workers AI REST API. It needs `CLOUDFLARE_API_TOKEN` with Workers AI Read. It prints per threshold:

- **precision:** changes that were right
- **coverage:** rules' mistakes fixed
- **accuracy:** what users see

It also prints nDCG@10 for Best match, and median and p95 latency, tokens and cost. `metrics.test.ts` tests the scoring.

The bar for a threshold:

| Decision | Precision | Coverage |
| --- | --- | --- |
| Link category | at least 95% of changes | at least 30% of the rules' mistakes |
| Card type | at least 95% of changes | at least 50% of the rules' mistakes |
| Each style | at least 85%, at the best F1 | at least 50% recall |

A decision that can't meet both its precision and coverage bars stays off: raise its threshold to 1 and say so in the PR.

## Break-it Checklist

- **AI gate.** With AI off and while paused, every feature gives today's answer and the worker gets no Clef op.
- **Errors.** Clef capacity errors, timeouts and invalid answers (a missing id, an unknown label, NaN) all give today's answer, and the card completes.
- **Category.**
  - Domain and path matches never reach Clef, and the 30-day category cache still skips.
  - Backfill: the dry run matches the real run's counts, a re-run moves nothing, and it never writes `other`.
- **Card type.** An explicit quote stays a quote. A palette with no parseable colours stays text. A 50,000-character note is truncated, not failed.
- **Styles.** A rendition over 4 MiB gets no styles from Clef and falls back. `style:3d` and `style:hand-drawn` parse on the web, CLI and MCP.
- **Best match.**
  - Qualifier-only searches never call Clef.
  - 61 new searches in a minute fall back, both when the semantic cache misses and when it hits.
  - Paging during a late score never repeats or skips a card, on the grid and the API.
  - A card edited after scoring is scored again.
  - Changing a filter on the same words asks again.

## Release Gate

1. Run `scripts/clef-eval` for all four features, tune `DECISION_THRESHOLDS` against the bar above, and bump each changed decision's `DECISION_VERSIONS`. Put the tables in the PR.
2. Run the repo checks and `journey/03-api.e2e.ts`.
3. With CI green, merge.
4. Deploy in order, which `scripts/check-files-readiness.ts` enforces:
   1. The Files Worker (the four new ops and `visualStyles` on the image op).
   2. Convex (the new table, `sort=relevance` and the widened style values).
   3. Web.
5. Run both backfills as dry runs (`npx convex run migration/backfillLinkCategoriesClef:backfillLinkCategoriesClef`, `npx convex run migration/backfillVisualStyles:backfillVisualStyles`). Send the totals to the owner, run a `userId` canary, then run the rest only with the owner's approval (`packages/convex/AGENTS.md`).
6. Production smoke test: one unquoted quote, one unruled link, one image, and one Best match search. Check `adminUsage` for Clef rows.

## Risks And Open Questions

- **New models.** Clef launched on 2026-10-01, and every benchmark is Cloudflare's own. The eval is the only accuracy evidence before users see changes.
- **Rate limits.** Workers AI publishes none for Clef. Watch the backfill canary for 429s before running the rest.
- **Rerank latency.** The grid scores after its meaning lookup, so a cold search can take longer than the 400 ms hold. Best match then shows only on a repeat of that search within 10 minutes, or on later pages of the API. If the eval's p95 is well over 400 ms, raise `RELEVANCE_HOLD_MS` or lower the depth to 32.
- **Cost.**
  - Rerank: about $0.0009 per uncached search.
  - Category: about $0.0001 per low-tier link on Clef 27B.
  - Styles: about $0.0001 per image.
  - Card type: under $0.0001 per text card.
- **Card type backfill.** Not planned. Existing text cards that are really quotes stay text.
- **Quotes made at save time aren't reviewed.** Text wrapped in quote marks and saved without a type becomes a quote when the card is created, and the classifier keeps created quotes as they are. So Clef's veto reaches only notes saved explicitly as text. Reviewing those quotes too needs a record of whether the type was chosen or inferred.
- **Explicit `text` can now flip.** Clef may turn a note the composer saved as text into a quote, as the palette regex already can. If unwanted flips show up, review only untyped cards.
- **Older Apple builds.** Apple reads the styles only from its bundled `SharedConstants.json`, for search tokens. Until an update, the new styles don't parse there. Nothing breaks.
