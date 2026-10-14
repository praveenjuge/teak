## Goal

Read the text inside images and video thumbnails in the same Gemma vision call that already writes their summary and tags. Store it as `aiOcrText`, make plain search find it, add a `text:` qualifier that searches only that text, and backfill existing images and videos. Phase 10 of the [roadmap v2](2026-10-14-roadmap-v2-00-roadmap.md).

## Depends on

- Nothing in v2. Phases ship in order, so [phase 4](2026-10-14-roadmap-v2-04-hidden-cards.md) (`isHidden` on `cardSearchDocuments`) is already live, and the new search index copies its filter fields.

## Success Criteria

- A screenshot of a receipt that says "Invoice 4411" is found by `4411` and by `text:4411`. A note that only mentions 4411 is found by `4411` but not by `text:4411`.
- New images and videos get `aiOcrText` without a second model call: one `generate-image-metadata` call returns `{ tags, summary, text }`.
- Images with no legible text get no `aiOcrText` and keep the same summary and tags as before.
- Refresh details re-reads the text, and clears it when the model now finds none.
- The card detail panel shows a quiet "Text in image" block with a copy button. The API, MCP, SDK and CLI return `aiOcrText`, and `q=text:…` works everywhere `q` does.
- `backfillImageOcr` (dry run first) fills `aiOcrText` for existing images and videos without rewriting their summary or tags.

## Context And Current Facts

- The vision model is `IMAGE_METADATA_MODEL_ID = "@cf/google/gemma-4-26b-a4b-it"` in `apps/files-worker/src/imageMetadata.ts`. `generateImageMetadataForOp` sends the `detail` rendition (as a single JPEG frame, `anim: false`) with `IMAGE_ANALYSIS_SYSTEM_PROMPT`, which asks for exactly `{"tags": [...], "summary": "..."}` and "no other keys".
- `MAX_IMAGE_METADATA_OUTPUT_TOKENS = 768`. That is too small for a dense screenshot's text plus tags and summary: a cut-off answer fails `parseImageMetadata` and burns the 2 validation retries.
- `parseImageMetadata` already ignores unknown keys, so an old Convex deployment tolerates a `text` key from a new worker.
- The result types are not shared. The worker has `ImageMetadataResult`, and Convex has `FilesWorkerImageMetadataResult` in `storage/filesWorkerClient.ts`. `packages/files-protocol/src/metadata.ts` only covers text and link metadata (Qwen3 30B, `MAX_AI_METADATA_INPUT_CHARS = 6000`).
- `generate-image-metadata` has no entry in `OP_TIMEOUT_MS` (`filesWorkerClient.ts`), so Convex never times the call out.
- Convex calls the worker through `generateImageMetadataForStoredKey(sourceKey, title?)` in `workflows/aiMetadata/generators.ts`. It is used by the `image` branch (key from `resolveImageAnalysisKey`) and the `video` branch (`card.thumbnailKey`, titled by the file name) of `workflows/steps/metadata.ts`. Videos therefore get OCR from the same change.
- `updateCardAI` (`workflows/aiMetadata/mutations.ts`) patches only the keys it receives through `patchCardWithSearchSync`, so an omitted key cannot clear old text. `resetCardAI` clears `aiTags`, `aiSummary`, `aiTranscript` and `visualStyles`.
- Refresh details is `reprocessCardForUserHandler` (`card/updateCard.ts`), which reruns `cardProcessingWorkflow`.
- Search text is `buildCardSearchText` over `SEARCH_FIELDS` (`content`, `notes`, `aiSummary`, `aiTranscript`, `metadataTitle`, `metadataDescription`) plus tags (`card/searchDocumentHelpers.ts`). `patchCardWithSearchSync` resyncs whenever a field in `SEARCH_FIELDS` changes. `shared/search/localSearch.ts` keeps its own copy of the field list.
- `cardSearchDocuments` has one search index, `search_searchableText`.
- Qualifiers are `SEARCH_QUALIFIER_KEYS = ["tag", "type", "is", "site", "folder"]` in `shared/search/qualifiers.ts`. `combineSearchQueries` merges a smart folder's query with the typed one, and `resolveSearch` (`card/searchPlanner.ts`) turns qualifiers into a `ResolvedSearch`.
- Chips are labelled by `describeQualifierChip` in `packages/ui/src/components/search/searchSuggestions.ts`.
- The grid search reads at most `SEARCH_PAGE_CANDIDATE_LIMIT = 401` candidates (`card/getCards.ts`). The API reads `MAX_QUERY_SCAN = 400` (`publicApi.ts`).
- There is no index over every image card. `cards.by_type_derivative_version` (`["type", "derivativeVersion"]`) can page all cards of one type. Backfills follow `migration/backfillUrlHost.ts`: a paged `internalMutation` with `dryRun` defaulting to true. A mutation cannot call the worker, so it schedules actions.
- The local e2e stack runs no Files Worker or Workers AI (`packages/tests/README.md`), so card metadata stays `pending` there.

## Constraints And Non-goals

- One model call per image. There is no separate OCR op for new cards.
- The new fields are optional:
  - `aiOcrText` is capped at `MAX_IMAGE_OCR_CHARS = 4000`, exported from `files-protocol`.
  - `ocrCheckedAt?: number` marks a card as read even when it has no text, so the backfill can resume.
- The search index is added next to the old one. Its rebuild runs on deploy, so deploy in a low-traffic window and watch database I/O.
- Link screenshots and scanned PDFs are not covered here; they are phase 11.
- No change to how tags are post-processed. Phase 4 removes the reserved hidden tags from AI output, and OCR text never becomes tags.

## Files Worker

- `IMAGE_ANALYSIS_SYSTEM_PROMPT`:
  - The answer shape becomes `{"tags": [...], "summary": "...", "text": "..."}`.
  - `text` is all legible text, verbatim and in reading order, up to 4,000 characters, or `""` when there is none.
  - The model is told never to describe the image inside `text`.
- `MAX_IMAGE_METADATA_OUTPUT_TOKENS`: raise to 2048 and record the cost change in the PR.
- `parseImageMetadata`:
  - `text` is optional; a non-string value fails validation.
  - Normalize whitespace, cut at `MAX_IMAGE_OCR_CHARS`, and treat the result as empty when it has fewer than 3 letters or digits.
- `packages/files-protocol/src/metadata.ts`: add `FilesImageMetadataResult { summary, tags, text? }` and `MAX_IMAGE_OCR_CHARS`. Both the worker and Convex import them.
- No new op, so `FILES_OPS` and `scripts/check-files-readiness.ts` are unchanged.

## Backend

- `schema.ts`:
  - `cards.aiOcrText?: v.string()` and `cards.ocrCheckedAt?: v.number()`.
  - `cardSearchDocuments.ocrText?: v.string()`.
  - `.searchIndex("search_ocrText", { searchField: "ocrText", filterFields })`, with the same filter fields as `search_searchableText` (including phase 4's `isHidden`).
- `generators.ts`:
  - `generateImageMetadataForStoredKey` returns `aiOcrText`.
  - Add `"generate-image-metadata": 120_000` to `OP_TIMEOUT_MS`.
- `steps/metadata.ts`:
  - The image and video branches pass `aiOcrText` and `ocrCheckedAt` to `updateCardAI`.
  - `updateCardAI` takes `aiOcrText` and maps `""` to `undefined`, so a refresh clears stale text.
  - `resetCardAI` clears both new fields.
- `searchDocumentHelpers.ts`:
  - Add `aiOcrText` to `SEARCH_FIELDS`, so plain search, the resync trigger and the phrase checks all include it.
  - The sync also writes `ocrText`.
  - Add `searchCardsByOcrText(ctx, args)` next to `searchCardsByDocument`, with the same limits and errors.
  - Mirror the field in `localSearch.ts`.
- `qualifiers.ts`:
  - Add `"text"` to `SEARCH_QUALIFIER_KEYS` and `{ key: "text"; value: string }`. The value keeps its case and quotes (`text:"total due"`).
  - `ParsedSearchQuery.ocrTexts` collects the values. Several `text:` qualifiers must all match.
  - `combineSearchQueries` adds them up, the same way as tags.
- `searchPlanner.ts`:
  - `ResolvedSearch.ocrText` holds the values joined.
  - `matches` checks that every `text:` value is in `aiOcrText`, ignoring case.
- `getCards.ts`:
  - When `ocrText` is set, the OCR index drives the read.
  - Plain words then run their own `searchCardsByDocument` read, and the two candidate sets are intersected by card id.
  - The sort is applied after, unchanged.
- `publicApi.ts` and `publicApiHttpValidation.ts`:
  - `q` qualifiers carry `ocrTexts`.
  - `searchCardsPageForUser` takes `ocrTexts: v.optional(v.array(v.string()))` and uses the same driver.
  - `serializeCard` adds `aiOcrText`.
- `migration/backfillImageOcr.ts`:
  - A paged mutation over `by_type_derivative_version` for `image`, then `video`. Candidates have no `ocrCheckedAt` and a `resolveImageAnalysisKey` key or a `thumbnailKey`.
  - A dry run reports the counts.
  - A real run schedules `backfillImageOcrCard` actions 2 s apart, 25 per page.
  - The action calls the same op but writes only `aiOcrText` and `ocrCheckedAt`, never the summary or tags.
- `shared/analytics.ts`: add `search_performed.qualifiers?: string[]` so `text` usage is counted.

## Web

- `CardMetadataPanel.tsx`: a "Text in image" block under Summary. It shows the first 6 lines, then "Show all". A copy icon button sits next to it, and the text has `dir="auto"`. It is hidden when `aiOcrText` is empty.
- `describeQualifierChip`: `text` gets the title "Text in image" and the value as its label.
- `searchSuggestions.ts`: offer `text:` while typing `te`.

## API / MCP / SDK / CLI

- `aiOcrText` in the card JSON, `publicApiOpenApi.ts` card properties, the SDK `Card` type and `teak cards get` detail output.
- The `q` descriptions in `mcp/tools.ts` (`cardFilterProperties.q` and `teak_v1_search_cards`), OpenAPI and the CLI help mention `text:"…"`.

## Docs

- `features.mdx` "Smart search": a `text:` row in the token table, and a line saying text inside images and video thumbnails is searchable. Add OCR to the "AI enrichment" list.
- `(developers)/api.mdx`, `mcp.mdx`, `(apps)/cli.mdx`: `aiOcrText` and `text:`.
- Ship-month changelog: "Find screenshots by the words in them".

## UI states

- Empty: no "Text in image" block, and no placeholder.
- Loading: none of its own. While metadata is processing, the panel keeps today's skeleton.
- One item / many items: `text:` on 0 results shows the usual empty search. With 401+ matches it uses the usual "Search is too broad" refusal.
- Very long: 4,000 characters clamp to 6 lines with "Show all". RTL and CJK text gets `dir="auto"`, and a code screenshot keeps its line breaks in a monospace block.
- Error: OCR failure is silent and the card looks as it does today.
- Rate-limited: Refresh details keeps its existing limit messages.

## Scenario seed packs

- `ocr-images`, added to `devSeed.seedScenario`:
  - 40 cards with pre-filled `aiOcrText`: code, memes, handwriting, receipts, Arabic, Hebrew, Japanese and Hindi signs, text-free photos (no field), a 4,000-character wall of text.
  - A twin note that shares a keyword with each image, for the `text:` vs plain-search checks.
- Real uploads through the app on the dev deployment from `apps/files-worker/src/fixtures` plus new fixtures: an 8K screenshot, an animated GIF with text in frame 2 (only frame 1 is read), a HEIC receipt, a tiny 40px icon (skipped by `hasKnownTinyImageDimensions`), and a video whose thumbnail has a title card.

## Break-it checklist

- UI:
  - `text:` chip add and remove; `text:"two words"`; `text:` alone; `text:` inside a smart folder
  - Copy at 390px; Show all on RTL text
  - Back and forward between `text:` searches; the light and dark block
- Backend:
  - A 768-token-style cut-off answer (mocked) is retried and then deferred, never stored half-written.
  - The model returns `"text": 42` or a description instead of text.
  - Refresh after the text was removed clears `aiOcrText`.
  - An old worker without `text`, and an old Convex with the new worker.
  - `text:` on another user's cards; on trashed, archived and hidden cards; `text:` together with `#private`.
  - The backfill dry-run counts; a resume after `once: true`; it skips accounts that are being deleted and never changes `aiSummary`.

## Tests

- `apps/files-worker/src/imageMetadata.test.ts` (new): a table for `parseImageMetadata` covering missing, empty, non-string, oversized and fenced `text`, and noise-only text.
- `apps/files-worker/src/upload.test.ts`: `generateImageMetadataForOp` returns `text` from a mocked `AI.run`.
- `packages/files-protocol/src/index.test.ts`: the shared cap and result type.
- `packages/convex/__tests__/workflows/aiMetadata/generators.test.ts`: `aiOcrText` mapping.
- `packages/convex/__tests__/workflows/steps/metadata.test.ts`: image and video branches store the text; an empty answer clears old text.
- `packages/convex/__tests__/shared/search/qualifiers.test.ts`: `text:` parsing, quoting, canonical form and `combineSearchQueries`.
- `packages/convex/searchQualifiers.test.ts` (convex-test, already in `vitest.config.ts`):
  - plain search vs `text:` on seeded OCR
  - intersection with plain words
  - another user's cards, trash and hidden
- `packages/convex/__tests__/migration/backfillImageOcr.test.ts`: the dry run writes nothing; summaries are untouched; pages resume.
- `packages/convex/__tests__/publicApiHttpCards.test.ts` and `__tests__/mcp.test.ts`: `aiOcrText` in the JSON and `q=text:`.
- `packages/ui/src/components/card-modal/__tests__/CardMetadataPanel.test.tsx` (new): the block renders, clamps and hides.
- `packages/ui/src/components/search/__tests__/searchSuggestions.test.ts`: chip label.
- `packages/tests/src/web/search-qualifiers.e2e.ts`:
  - the `text:` chip round-trips through the URL and shows the empty state
  - the detail panel block, through `routeConvexSocket` with a rewritten card, since the local stack has no AI

## Proof before the PR

- Video 1: upload a receipt screenshot on dev, wait for processing, search a number from it, open the card and copy the text.
- Video 2: `text:"total due"` vs plain `total due`, then a Japanese sign.
- Screenshots of the panel block (short, long, RTL) and the `text:` chip: light and dark, 390px and 1440px.
- Captured `GET /v1/cards?q=text:4411`, the MCP `teak_v1_search_cards` output, `teak cards search 'text:4411'`, and the backfill dry-run report.

## Release gate

1. The narrow tests above, then the repo checks and `03-api.e2e.ts`, `04-cli.e2e.ts`, `05-mcp.e2e.ts` and `search-qualifiers.e2e.ts`. Break `parseImageMetadata` and the planner on purpose and confirm the new tests fail.
2. Seed `ocr-images`, upload the real fixtures on dev, run the break-it pass, then fix and add regression tests.
3. Send the proof bundle.
4. PR, green CI, merge. Then:
   1. Deploy the Files Worker first: `bun run --cwd apps/files-worker deploy:development`, then `deploy`.
   2. Run `scripts/check-files-readiness.ts --prod`.
   3. Deploy Convex in a low-traffic window, since the `search_ocrText` index builds. Then deploy web.
   4. Run `migration/backfillImageOcr:backfillImageOcr` as a dry run, then `{"dryRun": false}` in pages. Watch Workers AI usage and Convex I/O.
   5. Smoke-test in production: upload a screenshot and search its text.

## Risks And Open Questions

- **Output cost.** 2048 output tokens on every image costs more. Measure the average output tokens on 100 dev images before merging. If the cost is high, lower the cap and keep `text` at 2,000 characters.
- **Mixed answers.** Mixing OCR into the summary call can make the summary or tags worse. Compare 50 dev images before and after the change.
- **Backfill volume.** One Gemma call per existing image and video. Page slowly, and stop when Workers AI reports capacity errors (`AI_CAPACITY`).
- **Contradiction (minor).** The master plan lists the image result as passing through `files-protocol` metadata. Today there is no shared image result type; this phase adds one.
