## Goal

Use Cloudflare's Clef decision models on Workers AI for four typed decisions that are rules-only today:

1. **Link category.** Clef picks the category when no domain or path rule matches.
2. **Card type.** Clef decides text, quote or palette for text-only cards.
3. **Visual styles.** Clef judges each style straight from the image, for images and video thumbnails, over a taxonomy that grows from 13 to 19 styles.
4. **Best match.** A new search sort reranks the top 64 results by relevance to the query.

Clef only. One PR, shipped straight on with no shadow phase or flag.

## Decisions (from the owner, 2026-10-16)

| Topic | Decision |
| --- | --- |
| Model | Clef 27B (`@cf/cloudflare/clef`) for link category. Clef-flash (`@cf/cloudflare/clef-flash`) for card type, visual styles and reranking. |
| AI gate | Same as tags and summaries (`getAiGate`). `user_disabled` and `paused` both fall back to today's rules. |
| Rollout | Ship straight on. No shadow mode, no PostHog flag. |
| Plan | Every plan. No premium gate (`.agents/feature-conventions.md`, "Plans and limits"). |
| Category: when | Only when the rules' answer came from the provider mapping, a keyword or the `other` fallback. Domain and path rules stay final. |
| Category: input | URL, host, title, description, site name, and the JSON-LD `@type` values. |
| Category: low confidence | Keep the rules' answer. |
| Category: list | Today's 15 categories, independent of phase 18. The list grows with phase 18. |
| Category: existing links | Dry-run backfill. |
| Card type: decisions | Unquoted quotes become quotes. Clef judges palettes. Clef can veto a rule's quote or palette guess, so the card stays text. |
| Card type: user intent | Same as today's rules. Clef may change a text card when confident, as the palette regex does now. An explicitly saved quote stays a quote. |
| Card type: latency | Acceptable. A card may flip type a moment after saving. |
| Styles: source | Clef judges every style directly. The alias map no longer assigns styles; it stays for search parsing. |
| Styles: cards | Images and video thumbnails. |
| Styles: taxonomy | Add typographic, 3d, flat, geometric, hand-drawn and futuristic (19 in total). |
| Styles: existing cards | Dry-run backfill. |
| Rerank: UX | A new "Best match" sort. It is the default while a search has free words; newest stays one click away. |
| Rerank: surfaces | Web grid (and the extension, through `packages/ui`), plus API, MCP, SDK and CLI. Native apps and Raycast are out of scope. |
| Rerank: depth | The fused top 64, in one Clef-flash request. |
| Rerank: waiting | Hold the first paint up to about 400 ms. If the scores are late, keep the fused order for that search and never reshuffle. |
| Rerank: judgement | A `score` rubric from 0 to 3. |
| Rerank: cost guard | Counts against the existing `semanticSearch` limit (60 uncached searches per minute per user). Cached for 10 minutes. Over the limit, results keep the fused order. |
| Eval data | Seeded dev cards plus committed, hand-labelled public fixtures. No real user content. |
| Delivery | One PR. Order inside it: shared base, link category, card type, visual styles, Best match. |

## Depends on

- Nothing on the roadmap. Phase 18 (new categories) can land before or after. Whichever lands second adds descriptions for its categories (see `LINK_CATEGORY_DESCRIPTIONS` below).

## Success Criteria

**Link category**
- A link to a recipe, film, course or podcast page on a site with no rule gets the right category. Today such a link gets `other` or a keyword guess.
- Domain and path rule results never change.
- When Clef fails or isn't confident, the card gets exactly today's answer.

**Card type**
- `Make it work, then make it fast. — my old teacher`, saved with no quote marks, becomes a quote card.
- A CSS snippet with two hex codes stays text.
- A dialogue line in quote marks that isn't a quotation stays text.
- `#264653 #2a9d8f #e9c46a` is still a palette.
- A palette needs at least one parsed colour, or it stays text.

**Visual styles**
- Image and video cards get up to 4 styles from the 19.
- The `style:` filter matches video cards too.
- The 6 new styles show in the web search bar, the CLI and MCP.
- An image whose Clef call fails gets today's alias-map styles.

**Best match**
- While a search has free words, the web grid defaults to "Best match".
- `GET /v1/cards?q=…&sort=relevance` orders by relevance. MCP, the SDK and the CLI expose the same sort.
- On the dev seed, nDCG@10 is at least the fused order's.
- A late or failed rerank never moves cards under the user.

**All four**
- A user with AI turned off sees today's behaviour.
- `adminUsage` records the token use and cost of every call.

## Context And Current Facts

**Workers AI is already the only model provider.**
- All model calls run in the Files Worker with the `AI` binding (`apps/files-worker/wrangler.jsonc`, `"ai": {"binding": "AI"}`) and `aiRunOptions(env)` (`apps/files-worker/src/aiGateway.ts:35`). The gateway applies `collectLog: false, skipCache: true`.
- Convex calls the worker through `callFilesWorkerJson` with HMAC-signed `{op, params}`. Ops are listed in `packages/files-protocol/src/index.ts` and dispatched in `apps/files-worker/src/ops.ts`.

**What Clef takes and returns.**
- Request:
  - `state`: a string or JSON.
  - `questions`: 1–64 entries, keys up to 100 characters from `[A-Za-z0-9_.-]`.
  - Question types: `noul` (yes/no probability), `choice` (`criteria` maps labels to descriptions; returns the choice, per-label probabilities and confidence) and `score` (`criteria` is an ordered array of levels; returns a probability-weighted score from 0).
  - `images`: optional, up to 4 inline PNG, JPEG or WebP. Each is at most 4 MiB and 16 MP, 8 MiB decoded in total. No URLs.
- Limits:
  - Context is 65,536 tokens; `state` is truncated without warning to fit.
  - An image costs up to 1,024 tokens.
- Behaviour:
  - Questions are evaluated in isolation and in parallel.
  - There is no "don't know" answer.
  - Ties follow option order.
  - Confidence measures how concentrated the probabilities are, not how likely the answer is to be right.
- Pricing: input only. Clef is $0.24 per million tokens, Clef-flash $0.09.
- Latency (vendor medians): Clef about 209 ms, Clef-flash about 39 ms.

**Link category today.**
- The workflow (`workflows/cardProcessing.ts:155-211`) runs three actions: `classifyStep`, then `fetchStructuredDataStep` only when `shouldFetchStructured`, then `mergeAndSaveStep`.
- `classifyLinkCategory` (`workflows/steps/categorization/index.ts:124`) calls `resolveLinkCategory` (`shared/utils/linkCategoryResolver.ts:218`), which returns a `reason`:
  - `domain_rule`: 0.98
  - `path_rule`: 0.8
  - `provider_mapping`: 0.72
  - `heuristic`: 0.58
  - `fallback`: `other`, 0.35
- `mergeAndSaveHandler` (`:546`) is the first point that holds both the classification and the structured data. It calls `enrichLinkCategory`, which runs provider enrichment. `enrichProvider` keeps a provider's facts only when the category is one the provider lists, unless confidence is below 0.6.
- A fresh category (30 days, same URL) skips reclassification.
- Categories are not searchable. They drive facts, provider enrichment and (with phase 15) done states.

**Card type today** (`workflows/steps/classification.ts`, the `classify` action):
1. An explicit `quote` with no URL or file is sticky.
2. Quote marks around the content (`normalizeQuoteContent`, `card/quoteFormatting.ts:93`) make a quote at 0.95.
3. Otherwise `deterministicClassify` (`:341`) runs. For text-only cards it ends in the `isProbablyPalette` regex (palette at 0.9) or text at 0.7.
4. A type changes when it differs and confidence is at least 0.6.

The web composer sends `type: "text"` for multi-block notes (`packages/ui/src/components/text-editor/noteCapture.ts:62`).

**Visual styles today.**
- `VISUAL_STYLE_TAXONOMY` (13 styles), `VISUAL_STYLE_LABELS` and `VISUAL_STYLE_ALIAS_MAP` live in `shared/constants.ts:24-150`.
- `metadata.ts:276` derives styles from Gemma's tags with `extractVisualStylesFromTags`. Only image cards store them (`:429`), and the `style:` filter matches only images (`card/visualFilters.ts:81` and `VISUAL_STYLE_TYPES` at `:141`).
- Styles are part of the embedding text (`embedding/text.ts`), so a change re-embeds the card.
- The constants feed:
  - the web search bar (`packages/ui/src/components/search/SearchBar.tsx`)
  - MCP (`mcp/tools.ts`)
  - the CLI (`apps/cli/src/index.ts`)
  - the Apple app, through the generated `SharedConstants.json` (`apps/apple/scripts/shared-constants.ts`)

**Search today.**
- `card/getCards.ts:586-640` fuses keyword and meaning matches with reciprocal rank fusion (`fuseRankings`) into up to 401 candidates. It then sorts them by `createdAt` or a seeded shuffle, and paginates by offset.
- `CardListSort` is `newest | oldest | shuffle` (`shared/search/sort.ts`); `normalizeCardListSort` maps unknown values to `newest`.
- Queries can't call the worker. The web grid calls `search/semanticActions:requestSemanticResults` beside the query, and the query reads the cached ranking (`.agents/semantic-search.md`, "Hybrid search").
- The API fetches the ranking before it reads a page, with a 1.5 s timeout.

## Constraints And Non-goals

- Rules stay first. Clef answers are accepted only above a threshold tuned on the eval set. Any Clef error, timeout or low confidence keeps today's answer, and no card fails because Clef failed.
- No new workflow steps and no reordering. Every Clef call lives inside an existing action, so in-flight journals replay (`.agents/feature-conventions.md`).
- No card content is logged. Calls go through `aiRunOptions(env)`, like today's metadata calls.
- Non-goals:
  - other decision-model vendors
  - native-app Best match and Raycast
  - a card type backfill (see Risks)
  - Clef for generative work (tags, summaries, OCR)

## Shared Base

**`packages/files-protocol/src/decisions.ts`** (new):
- `CLEF_MODEL_ID = "@cf/cloudflare/clef"` and `CLEF_FLASH_MODEL_ID = "@cf/cloudflare/clef-flash"`, with request `model` values `"clef"` and `"clef-flash"`.
- Types for `NoulQuestion`, `ChoiceQuestion<L>`, `ScoreQuestion` and their answers.
- Constants: `MAX_DECISION_QUESTIONS = 64` and the image limits.
- Prompt versions: `LINK_CATEGORY_DECISION_VERSION`, `CARD_TYPE_DECISION_VERSION`, `VISUAL_STYLE_DECISION_VERSION`, `RELEVANCE_DECISION_VERSION`. Telemetry records them, and the rerank cache key includes its version.

**Files Worker op `decide`:**
- Add it to the op list in `packages/files-protocol/src/index.ts` and dispatch it in `apps/files-worker/src/ops.ts`.
- New `apps/files-worker/src/decide.ts`:
  - Params: `{ model: "clef" | "clef-flash", state, questions, imageKey? }`.
  - With `imageKey`, the worker reads the same rendition `generate-image-metadata` uses, so Convex never moves image bytes. A rendition over the 4 MiB or 16 MP limit is skipped and the op returns `IMAGE_TOO_LARGE`.
  - Calls `env.AI.run(modelId, { model, state, questions, images }, aiRunOptions(env))`.
  - Validates every answer:
    - each question id is present
    - a `choice` label is one of its criteria
    - probabilities are finite and sum to about 1
    - a `score` lies within the levels
  - An invalid answer is an error, never a partial result.
  - Retries capacity errors twice, reusing the capacity check in `imageMetadata.ts`, and returns `usage`.

**Convex `packages/convex/ai/decide.ts`** (new):
- `runDecision(ctx, { userId, op: "link_category" | "card_type" | "visual_styles" | "relevance", ... })`.
- It checks `getAiGate` and returns `null` unless `allowed`.
- It calls the op with a timeout: 3 s for card processing, 1.5 s for search.
- It records usage through `observeAiGeneration` and `adminUsage.recordAiUsage`.
- Add both models to the price table in `ai/telemetry.ts` (input $0.24 or $0.09 per million, output $0) and to the model list in `ai/models.ts`.
- Remove the unused `ai/schemas.ts`: nothing imports it, and it described the old LLM classifier.

**Eval harness `scripts/clef-eval/`** (manual, not part of `bun run test`):
- `fixtures/link-categories.json`: about 150 public URLs on sites with no domain rule, each with its title, description, JSON-LD types and a hand label.
- `fixtures/card-types.json`: about 120 snippets, including unquoted quotes, dialogue in quote marks, CSS, colour lists, prose with colour names and plain notes.
- `fixtures/visual-styles/`: about 100 CC0 images, kept small, with multi-labels over the 19 styles.
- `fixtures/search.json`: the dev seed queries with hand-marked relevant cards. Reuse the 38-card, 33-query set from `.agents/semantic-search.md` if it's committed; otherwise rebuild it and commit it here.
- `run.ts --feature <name> --model <clef|clef-flash>` calls the Workers AI REST API and prints:
  - accuracy and a confusion matrix
  - precision and coverage at each threshold from 0.5 to 0.95
  - token use and median and p95 latency
  - nDCG@10 against the fused and newest orders, for search
- It needs a Cloudflare account ID and a Workers AI token. Document both in `.agents/environment.md`, owned by the developer and never by CI.
- Thresholds go in `shared/decisionThresholds.ts`. The bar:
  - at least 95% precision on changed answers for category and type
  - the best F1 for styles
  - a style precision of at least 0.85

## Feature 1: Link Category

- **Descriptions.** `shared/linkCategories.ts` gains `LINK_CATEGORY_DESCRIPTIONS: Record<LinkCategory, string>`, an exhaustive one-line description per category (for example `recipe: "A page with ingredients and steps for cooking a dish"`). Being exhaustive, the type check forces phase 18 to describe its additions.
- **Structured data.** `classifyStep` sets `shouldFetchStructured` whenever the resolution reason is `provider_mapping`, `heuristic` or `fallback`, so JSON-LD is present for the decision. Fresh structured data is still reused.
- **The decision**, in `mergeAndSaveHandler` (classified mode only), before `enrichLinkCategory`:
  - Inputs:
    - `state = { url, host, title, description, siteName, jsonLdTypes }`
    - `jsonLdTypes`: unique `@type` values, at most 8
    - `description`: cut to 1,000 characters
  - The question is one `choice` named `category`. Criteria are all categories with `other` listed first, so a tie falls to the safe default.
  - Model: Clef 27B.
  - When the choice differs from the rules and its probability is at least `LINK_CATEGORY_THRESHOLD`, it replaces the classification, with `confidence` set to that probability. Otherwise the rules stand.
- **Provider facts.** When the rules' reason was `provider_mapping` and Clef picks a category the provider doesn't list, enrichment runs with the rules' category so the provider's facts survive, and the stored category is Clef's. There's a test for an Amazon book (product provider, `book` category).
- **Backfill** `migration/backfillLinkCategoriesClef.ts` follows `backfillUrlHost.ts`:
  - `dryRun` is true by default, with `userId`, `once` and `cursor`.
  - It pages link cards, 100 at a time, and recomputes `resolveLinkCategory`. Cards with a domain or path match are skipped.
  - The rest are queued in jobs of 8, one job every 2 s.
  - Each job runs the decision. A changed card re-runs `enrichLinkCategory` on its stored structured data (hydrated with `hydrateArchivedMetadata`), so its facts match the new category. It is written through `patchCardWithSearchSync`.
  - Report: counts per `from→to` pair, unchanged, skipped and failed.
  - It never moves a card to `other`, and it skips accounts being deleted.

## Feature 2: Card Type

**Scope:** cards with no `url` and no `fileKey`, after the explicit-quote sticky branch.

**Flow in the `classify` action:**
1. Compute the rules' answer as today: a heuristic quote, `isProbablyPalette`, or text.
2. Ask Clef-flash:
   - `state`: the first 4,000 characters of `content`.
   - The question is one `choice` named `type`, with criteria listed in this order:
     - `text`: "Notes, lists, prose, code or anything else written by the person"
     - `quote`: "A quotation of someone else's words, usually with who said it"
     - `palette`: "A set of colours meant to be kept together as a palette"
3. Clef's choice replaces the rules' answer when its probability is at least `CARD_TYPE_THRESHOLD`. Two guards:
   - `palette` also needs `extractCardColors(text).length > 0`, or the card stays text.
   - A Clef `quote` on content without quote marks keeps the content as written.
4. Record the result through `recordClassification` with Clef's probability as `confidence`, and keep the `shouldUpdateType` rule (the type differs and confidence is at least 0.6).
5. When there's no Clef answer, the outcome is exactly today's.

**Effects:**
- Clef can veto a heuristic quote or a palette regex hit (the card becomes text) and can add unquoted quotes.
- Card processing now waits for one Clef-flash call on text-only cards.
- No backfill.

## Feature 3: Visual Styles

**Taxonomy.** `VISUAL_STYLE_TAXONOMY` gains `typographic`, `3d`, `flat`, `geometric`, `hand-drawn` and `futuristic`.
- Labels: "Typographic", "3D", "Flat", "Geometric", "Hand-drawn", "Futuristic".
- Search aliases:
  - `typography`, `lettering` → typographic
  - `render`, `cgi`, `isometric` → 3d
  - `flatdesign`, `vector` → flat
  - `geometry`, `shapes` → geometric
  - `handdrawn`, `lineart`, `doodle` → hand-drawn
  - `scifi`, `cyberpunk`, `futurism` → futuristic
- New `VISUAL_STYLE_DESCRIPTIONS: Record<VisualStyle, string>` holds the question text.
- Regenerate `SharedConstants.json` with `bun --no-env-file run apps/apple/scripts/shared-constants.ts --write`.

**Decision.** In `workflows/steps/metadata.ts`, `case "image"` and the thumbnail branch of `case "video"` run the decision alongside the Gemma tags call (`Promise.all`), so card processing waits no longer.
- Model and input: Clef-flash with `imageKey`. `state` is the card's title or file name, or `""`.
- Questions: 19 `noul` questions, one per style ("Is this image <description>?").
- Styles are those with a probability of at least `VISUAL_STYLE_THRESHOLD`, sorted by probability and capped at 4.
- When the decision is `null` or fails, styles fall back to `extractVisualStylesFromTags(aiTags)` as today.

**Video.**
- `metadata.ts:429` writes `visualStyles` for video too.
- `VISUAL_STYLE_TYPES` and `doesCardMatchVisualFilters` (`card/visualFilters.ts:81,141`) accept video.
- `style:` docs and MCP descriptions say "images and videos".

**Backfill** `migration/backfillVisualStyles.ts`:
- Covers image cards and videos with a thumbnail. It has `dryRun`, `userId`, `once` and `cursor`.
- Jobs of 16, one every 3.2 s, the same pace as the embeddings backfill, since changed styles re-embed cards.
- Writes go through `patchCardWithSearchSync`. The report counts changed, unchanged, skipped (no rendition, or too large) and failed cards.

## Feature 4: Best Match

**Sort value.**
- `CardListSort` gains `"relevance"`, accepted by `normalizeCardListSort` and `CARD_LIST_SORTS`.
- It applies only when `semanticQueryText(parsed)` is non-empty; otherwise it behaves as `newest`. Older clients never send it.

**Candidates.**
- Extract the candidate computation in `getCards.ts` (keyword search, semantic merge and `fuseRankings`) into `search/candidates.ts` `computeSearchCandidates`.
- The query and the new action then agree on the same fused order.
- Under `relevance`, the fused order is kept rather than re-sorted by date.

**Cache table `searchRelevanceResults`:**
- Fields: `userId`, `key` and `scores: {cardId, score}[]`, plus `expiresAt` 10 minutes out.
- `key` is the SHA-256 of `RELEVANCE_DECISION_VERSION`, the search text, and the filters and qualifiers. The search text is never stored.
- Index: `by_user_key`.
- Cleanup: added to the hourly `cleanup-semantic-search-cache` cron.
- Account deletion and tests: covered in `accountDeletionData.ts` `ancillaryPage` and seeded in `accountDeletionWorkflow.test.ts` (`.agents/feature-conventions.md`).
- Scores are per card, because Clef evaluates each question on its own, so a later request only scores cards missing from the row.

**Action `search/relevanceActions:requestRelevance({ q, filters, mode })`:**
1. Make sure the semantic ranking is cached, using the existing path.
2. Read the top 64 candidates and compact card texts through an internal query. Each card text holds the type, title, host, AI summary, up to 6 tags and the first 300 characters of the body.
3. Skip cards already scored. Take a `semanticSearch` rate-limit token; when none is left, stop and leave the fused order.
4. Call Clef-flash:
   - `state = { query: searchText }`
   - One `score` question per card, keyed by card id, with the instruction "How well does this saved card match what the person is searching for?" and the card's text.
   - Criteria: `["Not related", "Loosely related", "Relevant", "Exactly what they are looking for"]`.
5. Upsert the scores.

**Ordering.**
- `getCards` with `sort: "relevance"` and `useRelevanceScores: true` orders the candidates by score, highest first, with ties and unscored cards in fused order.
- With `useRelevanceScores: false`, it keeps the fused order.
- Offset pagination is unchanged.

**Web.** In `packages/ui`, a new `useRelevanceRanking` hook next to `useSemanticSearch`:
- When the search text changes under Best match, it calls the action and holds the first paint up to 400 ms, showing the grid skeleton.
- If the action resolves in time, it queries with `useRelevanceScores: true`; otherwise with `false`.
- That flag stays fixed until the next search change, so later pages and late scores never reorder what the user sees.
- The sort menu gains "Best match", enabled only while the search has free words.
- Typing free words switches the sort to Best match unless the user chose a sort during that search; clearing the words restores the previous sort.

**API, MCP, SDK and CLI.**
- `GET /v1/cards` accepts `sort=relevance`. The handler awaits the ranking and then the relevance scores (cache first, 1.5 s timeout) before reading a page, and passes `useRelevanceScores` accordingly.
- The response gains `relevanceRanked: boolean`.
- Every page call re-checks the cache. Cursors resume after the last card served, as semantic cursors do.
- In order:
  - `publicApiOpenApi.ts`: the `sort` enum, and a description saying it needs `q`.
  - MCP search tool: the `sort` enum.
  - `client/sdk.ts`: the `sort` union.
  - CLI: `--sort relevance` (`apps/cli/src/index.ts`, `library.ts`).
  - The `scripts/public-parity.ts` filters.

## Web

- The search bar shows the 6 new styles (from the shared constants). The sort menu gains "Best match".
- No other new surface. Category and type changes show through existing card rendering.

## Docs

- `features.mdx`, AI enrichment:
  - Categorization: "Teak reads the page when no site rule fits".
  - Card type: unquoted quotes.
  - Visual styles: the 19 styles, and videos.
  - Search: Best match.
- `(developers)/api.mdx` and the MCP and CLI docs: `sort=relevance`, `relevanceRanked`, and styles on videos.
- Any docs page that lists the AI models Teak uses: add Clef and Clef-flash.
- The ship month's changelog.

## Analytics

- `search_performed` (`shared/analytics.ts:43`) gains `sort` and `relevance_ranked: boolean`. Follow `.agents/analytics.md`, and never send the query.

## UI States

- Loading: Best match shows the grid skeleton for at most 400 ms.
- Empty: Best match with no results shows today's "No cards found" after the semantic wait.
- One item / many: ordering only. 64 scored cards, then the rest in fused order.
- Very long names: unchanged.
- Error or rate-limited: fused order, `relevanceRanked: false`, no error shown.
- Styles: up to 4 style chips where styles show today, including on video cards.

## Scenario Seed Packs

`clef-decisions`:
- links on sites with no rule, one per category
- an Amazon book page (provider facts must survive)
- the card-type set from the eval: unquoted quotes, CSS, dialogue, colour lists
- images and a video for each new style
- 10 cards with paired queries for Best match

## Break-it Checklist

- **AI gate.** With AI off and while paused, every feature gives today's answer and the worker gets no `decide` call.
- **Errors.** Clef capacity errors, timeouts and invalid answers (a missing id, an unknown label, NaN) all give today's answer and the card completes.
- **Category.**
  - Domain and path matches never reach Clef.
  - The 30-day category cache still skips.
  - The backfill's dry run matches the real run's counts, and re-running it moves nothing.
  - The backfill never writes `other`.
- **Card type.**
  - An explicit quote stays a quote.
  - A palette with no parseable colours stays text.
  - A 50,000-character note is truncated, not failed.
  - Emoji and CJK quotes.
- **Styles.**
  - A rendition over 4 MiB, a 1×1 image, an animated GIF and a video without a thumbnail.
  - `style:3d` and `style:hand-drawn` parse on web, CLI, MCP and Apple.
  - An older Apple build shows a card with a new style without crashing.
- **Best match.**
  - Qualifier-only searches never call Clef.
  - 61 searches in a minute fall back.
  - Paging during a late score never repeats or skips a card.
  - A card edited or deleted after scoring.
  - Trash, archive and favorites filters.
  - A query in Japanese.
  - The key changes when filters change.

## Tests

- `packages/convex/__tests__/ai/decide.test.ts`: gate handling, timeout, answer validation and usage recording, against a mocked op.
- `apps/files-worker/src/decide.test.ts`: request shape, rendition loading and size limits, answer validation, capacity retries.
- `packages/convex/__tests__/workflows/steps/categorization/index.test.ts`:
  - only low tiers call Clef
  - the threshold keeps the rules' answer
  - provider facts survive a category change
  - `other` sits first in the criteria
- `packages/convex/__tests__/workflows/steps/classification.test.ts`: the scenario set, mocked Clef answers, both guards, and no change without Clef.
- `packages/convex/__tests__/workflows/steps/metadata.test.ts`: styles from Clef, the cap of 4, the alias fallback, video styles.
- `packages/convex/__tests__/card/visualFilters.test.ts`: video matches `style:`.
- `packages/convex/__tests__/shared/constants.test.ts`: the 19 styles, labels, descriptions and aliases.
- `packages/convex/__tests__/shared/search/sort.test.ts` and a new `search/candidates.test.ts`: relevance ordering, ties, unscored cards, and the `useRelevanceScores` flag.
- `convex-test` (root `*.test.ts`):
  - the cache table's expiry and cleanup
  - account deletion of `searchRelevanceResults`
  - both backfills (dry run, resuming, idempotence)
- `scripts/public-parity.test.ts`: passes with `sort=relevance` on every surface.
- `packages/ui` hook test for `useRelevanceRanking`: the 400 ms hold, the fixed flag, no reorder.
- `packages/tests` journey: API `sort=relevance` against the local stack, with the decide op stubbed by the emulator setup, as the semantic search journey does.

## Proof Before The PR

- **Eval report** from `scripts/clef-eval` for all four features: the chosen thresholds, precision and coverage, latency, cost per 1,000 cards or searches, and Clef against Clef-flash for link category.
- **Video 1:** save an unquoted quote, a CSS snippet and a palette, and watch the types settle.
- **Video 2:** save links on unruled sites and see the facts appear.
- **Video 3:** search under Best match against Newest on the seed.
- **Screenshots:** the new style filters and a video card's styles, in light and dark, at 390, 768 and 1440 px.
- **Both backfills' dry-run reports** from dev.

## Release Gate

1. Run the narrow tests above, then the repo checks.
2. Seed `clef-decisions` and run the break-it pass until it is clean.
3. Send the proof bundle to the owner.
4. Open the PR. With CI green, merge.
5. Deploy order:
   1. The Files Worker (`decide` op).
   2. Convex (schema: the new table and the widened style values).
   3. Web.
6. Run both backfills as dry runs and send the totals to the owner. Run the real pages only with the owner's approval (`packages/convex/AGENTS.md`).
7. Production smoke test: one unquoted quote, one unruled link, one image, and one Best match search. Check `adminUsage` for Clef rows.

## Risks And Open Questions

- **New models.** Clef launched on 2026-10-01, and every benchmark is Cloudflare's own. The eval report is the only accuracy evidence before users see changes, since there is no shadow phase.
- **Rate limits.** Workers AI publishes none for Clef. Load-test the `decide` op on dev at backfill pace before the production backfills.
- **Rerank latency.** About 10,000 tokens of question text in one Clef-flash call. The vendor's 39 ms median is for small inputs, so measure p95. If the 400 ms hold is missed often, lower the depth to 32.
- **Cost.**
  - Rerank: about $0.0009 per uncached search.
  - Category: about $0.0001 per low-tier link on Clef 27B.
  - Styles: about $0.0001 per image.
  - Card type: under $0.0001 per text card.
  - The free 10,000 daily neurons cover dev.
- **Card type backfill.** Not planned. Existing text cards that are really quotes stay text. Decide after launch whether a dry-run backfill is wanted.
- **Explicit `text` can now flip.** Clef may turn a note the composer saved as text into a quote, as the palette regex already can. If owners see unwanted flips, switch to "only untyped cards".
- **Older Apple builds.** Apple's `Card` model doesn't decode `visualStyles`; it reads the styles only from the bundled `SharedConstants.json`, for search tokens. Until an update, `style:3d` and the other new styles don't parse there. Nothing breaks.
- **Privacy.** Card text and images go to Workers AI with logging off, as today's tags and summaries do. Rerank adds card text at search time, which needs a mention where the docs describe AI processing.
