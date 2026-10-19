## Goal

Give every archived link a clean reading view, and make what it says findable. A link card's modal gets a "Read" tab that shows the page's article in one carefully set typographic default. The article text is searchable by keyword and by meaning. The API, MCP, SDK and CLI can read it as Markdown. Phase 10 of the [roadmap v3](2026-10-19-roadmap-v3-00-roadmap.md).

## Depends on

- [Phase 9](2026-10-19-roadmap-v3-09-page-archive.md): extraction reads the stored archive, not the live page.
- [Phase 12](2026-10-19-roadmap-v3-12-highlights.md) builds on the Read tab and on the frozen article text that this phase stores.

## Success Criteria

- **Extraction.** A new workflow step, "extract article", turns a card's `pageArchive` into:
  - **The article as Markdown**, written to R2. Images become `teak-image:<n>` references, at most 20 per article.
  - **A plain-text search prefix** in `cardTextContents`, with `kind: "article"`.
  - **Article images** saved as R2 objects under the role `article-image`, at most 1600 px wide, in WebP.
  - **A `cards.article` summary** on the card: `{ textKey, imageKeys, wordCount, readingMinutes, title?, byline?, lang?, extractedAt }`.
- **Not an article.** Pages that fail the "is this an article" check are recorded as `cards.article = { status: "none" }`: fewer than 120 words of body text, or Readability's `isProbablyReaderable` returns false and the text is under 300 words.
- **The Read tab.** The link card modal shows a two-item segmented control above the stage, **Preview · Read**, but only when an article exists or is being extracted. `R` toggles between them.
  - It opens on Read when the card's category is `article`, `news` or `research`, and on Preview otherwise.
  - The reader shows a header (site, byline, "8 min read"), the title, then the article. A footer reads "Saved from example.com · 19 Oct 2026 · Open original ↗".
  - It is correct in light and dark at 390, 768 and 1440 px, and every link in the article opens in a new tab.
- **Search.**
  - **Keyword search** finds link cards by article text through `cardTextContents.search_text`, as it already does for documents.
  - **Meaning search:** the embedding text for a link includes the article's title, the AI summary and its opening (see Constraints).
  - **The summary:** a new step, "summarize article", regenerates a link's `aiSummary` from the article's first 6,000 characters when the article has 200 words or more. Tags are not regenerated.
- **API.**
  - `GET /v1/cards/{cardId}/content` returns `kind: "article"` with the Markdown. Images are signed absolute URLs, valid 7 days.
  - An optional `?kind=article|transcript|document|content` picks one kind when a card has more than one.
  - Serialized cards gain `article: { wordCount, readingMinutes } | null`.
  - MCP `teak_v1_get_card_content` gains `kind`, the SDK `cards.content(id, { kind })`, the CLI `teak cards content <id> [--kind article]`.
- **Backfill.** Cards that have a `pageArchive` and no `article` get an article-only run.
- **Refresh details** re-extracts the article. Phase 12 adds the exception for highlighted cards.
- **Native apps keep working.** They don't show the reader in v3.

## Context And Current Facts

- **Link card modal** (`packages/ui/src/components/card-modal/CardModal.tsx`):
  - `CardPreview` renders `LinkPreview` for links (`127-140`).
  - The stage wrapper class for links is `"px-5 py-6 md:px-10 md:py-10"` (`stageContentClass`, around 172).
  - Layout (807–850): `<main>` holds the stage, and `<aside aria-label="Card details">` holds `CardMetadataPanel` (`md:w-80 lg:w-[21rem]`).
  - The header has icon buttons and a ⋯ menu that contains "Refresh details" (763).
  - The modal has no tabs today.
- **Modal shortcuts** (`packages/ui/src/lib/keyboardShortcuts.ts:40-48`): ←/→, F, T, N, ⌘E, E and Delete. `R` and `H` are free.
- **`LinkPreview`** (`packages/ui/src/components/card-previews/LinkPreview.tsx`, 416 lines) renders the title, byline, facts, image or screenshot and media, inside `max-w-2xl`, linking out at 328 and 376.
- **Markdown rendering:**
  - `react-markdown` 10.1.0 is in `packages/ui` and used only by `FileTextPreview.tsx`, with the `.typeset` prose class (`packages/ui/src/typeset.css`: leading 1.75, 1.125em on mobile).
  - No remark-gfm.
  - The body font is SN Pro (`packages/ui/src/fonts.css`). There is no serif font today.
- **`cardTextContents`** (`packages/convex/schema.ts:949-962`):
  - `{ cardId, userId, kind: "document" | "transcript", text (search prefix), sourceKey, charCount, truncated }`, with `search_text` filtered by userId and one row per card (`.unique()` in `textContents.ts`, `documentText.ts`).
  - `storeDocumentText` (`card/documentText.ts:43-71`) writes the full text to R2 (`documentTextObjectKey`, `.../document-text/<sha256>.txt`) and the first 32 KiB to the row (`SEARCH_PREFIX_MAX_BYTES`, `documentTextFormat.ts:6`).
  - `saveDocumentTextHandler` (73–137) sets `documentTextKey`, `hasExtractedText` and `extractedTextCharCount` through `patchCardWithSearchSync`.
- **`getCardTextSource`** (`card/documentText.ts:161-205`):
  - returns kind `"document"` for any extracted row, then `aiTranscript`, then text/quote `content`;
  - a link with an article and a podcast transcript would hide the transcript, which is why `?kind=` is added.
- **Keyword search over file text:** `addCardsFoundByFileText` (`card/searchDocumentHelpers.ts:971-1011`) returns early unless `args.type` is undefined or `"document"`, and reads at most `FILE_TEXT_SEARCH_LIMIT` rows (a 4 MiB budget / 32 KiB).
- **Embeddings** (`packages/convex/embedding/text.ts:28-58`):
  - The text is title, description, AI summary, tags, notes, styles, OCR (2,000 characters) and then the body (2,000 characters), cut to 8,000 characters.
  - The body is `content` (if it is not the URL), then the extracted text, then the transcript.
  - The model reads about 480 tokens (`.agents/semantic-search.md`), so a link's body rarely counts today.
  - `embedding/state.ts:265-284` loads the extracted text from `cardTextContents` when `hasExtractedText` is set.
- **Link AI input:** `buildLinkContentParts` (`apps/files-worker/src/workflows/cardProcessing/metadata.ts:56`) takes the title, description, author and so on, plus an optional `transcript` (YouTube captions, 354–358). The model input is capped at 6,000 characters.
- **The content API:**
  - `GET /v1/cards/{cardId}/content` (`publicApiOpenApi.ts:1407-1462`), `cardContentResponse` (`publicApiHttpCards.ts:611-640`);
  - SDK `kind: "document" | "transcript" | "content"` (`client/sdk.ts:411-420`, validated at 754);
  - CLI `cards content <id>` (`apps/cli/src/index.ts:440`).
- **The workflow** ends, after phase 9, with "transcribe podcast" and then "archive page".

## Constraints And Non-goals

- **One typographic default.** No font, size, width or theme controls (the v3 decisions).
  - The reader uses `.typeset` with a `.typeset-reader` modifier: body font SN Pro (the app's own; no new serif download), 18px/1.7 at md+, 17px/1.65 below, measure `max-w-[68ch]`, headings in the heading font.
  - Images are full column width, `rounded-lg`, with muted 14px captions.
  - Tables scroll horizontally, and `pre` scrolls with the mono font.
- **The reader never renders the archive's HTML.** It renders the extracted Markdown through `react-markdown`, with `rehype-sanitize`'s default schema plus `teak-image:` resolution. So no page CSS or markup reaches the app's origin.
- **Embedding stays one vector per card.** The article only changes the summary, and adds its first 1,500 characters as the body when a link's `content` is the URL or the title. Chunked vectors are an open decision.
- **Article images:** at most 20 per article and 1600 px wide, taken from the archive's own `data:` images, so nothing is re-fetched.
- **Out of scope:**
  - no Highlights page and no reading progress;
  - no text-to-speech;
  - no native reader (owner: web and API now, native later);
  - no reader for non-link cards.
- **Analytics:** add `reader_opened { category, words_bucket, surface }` and `article_extracted { outcome: "article" | "none" | "failed", words_bucket }` to `shared/analytics.ts` first.

## Backend

- **`schema.ts`:**
  - `cardTextContents.kind` gains `v.literal("article")`.
  - `cards.article` is
    ```
    v.optional(v.union(
      v.object({ status: v.literal("ready"), textKey: r2KeyValidator,
        imageKeys: v.array(r2KeyValidator), wordCount: v.number(),
        readingMinutes: v.number(), title: v.optional(v.string()),
        byline: v.optional(v.string()), lang: v.optional(v.string()),
        extractedAt: v.number() }),
      v.object({ status: v.literal("none"), extractedAt: v.number() })
    ))
    ```
  - `processingStatus.article` is the new stage.
- **`card/articleText.ts`** (new): `saveArticleText({ cardId, textKey, searchText, charCount, truncated, article })`.
  - It is guarded, and listed in `workflowRpcAllowlist.ts`.
  - It writes the `kind: "article"` row, with the plain text from Markdown and `searchPrefix`.
  - It sets `hasExtractedText`, `documentTextKey = textKey` and `extractedTextCharCount`, plus `cards.article`, through `patchCardWithSearchSync`.
  - It queues the old text and image keys for deletion.
  - Reusing `documentTextKey`/`hasExtractedText` means keyword search, the embedding loader and the content API all pick it up with small changes.
- **`documentTextObjectKey`** gets a sibling, `articleTextObjectKey(prefix, cardId, digest)`: `.../article-text/<sha256>.md`. Article images live at `.../article-image/<sha256>.webp`.
- **`storage/cardObjectKeys.ts`:** add `card.article?.textKey` and `...(card.article?.imageKeys ?? [])`.
- **`getCardTextSource`:**
  - takes an optional `kind`;
  - returns `row.kind` (`"article"` or `"document"`) instead of always `"document"`;
  - without `kind`, the order is article or document, then transcript, then content;
  - with `kind`, it returns that kind or null.
- **`addCardsFoundByFileText`:** run when `args.type` is undefined, `"document"` or `"link"`.
- **`embedding/text.ts`:**
  - when the card is a link and `extractedText` is an article, use the article's opening (1,500 characters) as `body`;
  - `content` is used only if it isn't the URL or the preview title;
  - no `CARD_EMBEDDING_VERSION` bump is needed, because the per-card hash changes with the text.
- **`migration/backfillArticles.ts`:** dry run first. It pages over link cards with `pageArchive` and no `article`, and queues `{ articleOnly: true }` runs.
- **Card reads for the web** (`attachFileUrls`): add `articleUrl` (a signed URL for `article.textKey`) and `articleImageUrls` (signed, in order) for the modal. Grid list queries don't add them.

## Files Worker

- **`apps/files-worker/src/archive/article.ts`:** `extractArticle(archiveHtmlStream, pageUrl)`.
  1. **Stream** the archive through `HTMLRewriter`. Replace each `img[src^="data:"]` with `img[src="teak-image:<n>"]`, collect the first 20 image blobs (decoded, size-checked), and drop `style`.
  2. **Parse** the slimmed HTML with `linkedom` and run `@mozilla/readability` (`Readability(doc, { charThreshold: 500 })`). Both are permissive licences (Apache-2.0, ISC); the PR must confirm both are allowed.
  3. **Convert** to Markdown with `turndown` and `turndown-plugin-gfm` (MIT): fenced code, GFM tables, absolute links, and `teak-image:<n>` kept.
  4. **Images:** re-encode each one to WebP at ≤1600w with the `IMAGES` binding, and drop any over 4 MB after encoding.
  5. **Return** `{ markdown, plainText, wordCount, title, byline, lang, images }`, or `{ none: true }` under the thresholds in Success Criteria.
- **The new op `extract-article`** (`FILES_OPS`, `ops.ts`): reads `pageArchive.storageKey` from R2, runs `extractArticle`, and writes the Markdown and the images. Markdown is capped at `FILES_EXTRACTED_TEXT_MAX_CHARACTERS` (512 KiB), with `truncated` past it.
- **`run.ts`:** append "extract article" after "archive page", for link cards with a `pageArchive`. Then append "summarize article", which:
  - runs only when `wordCount >= 200`;
  - calls the existing link summary path, with `buildLinkContentParts` given the article's first 6,000 characters in the `transcript` slot (rename the parameter `bodyText`; it stays a single argument);
  - writes only `aiSummary`, guarded.
- **Failures** of either step are logged and set `processingStatus.article` to failed. The card still completes.
- **`articleOnly` runs** do "load card", then "extract article" and "summarize article".

## Web

- **`card-modal/CardModal.tsx`:**
  - For link cards with `card.article` (ready, or with a pending or in-progress `processingStatus.article`), render a `ToggleGroup` (shadcn, `type="single"`, size sm) at the top of `<main>`. It is sticky, with `bg-background/80 backdrop-blur`, and its items are "Preview" and "Read".
  - The choice is held in `useCardModal` state and resets per card. Its initial value follows the category rule above.
  - `R` toggles it, and is added to the "Card" group of the shortcut sheet: `{ keys: ["R"], label: "Read or preview" }`.
- **`card-previews/ArticleReader.tsx`** (new):
  - **Loading:** load `articleUrl` through the same cached fetcher as `FileTextPreview` (`requestFileTextPreview`, `card-previews/fileTextPreviewCache.ts:92`), with the cache keyed on `textKey`. While loading, a skeleton of a 2-line title and 8 text lines at reading width.
  - **Rendering:** `react-markdown` with `remark-gfm` (add `remark-gfm` to `packages/ui`) and `rehype-sanitize`. `img` with `teak-image:<n>` maps to `articleImageUrls[n]`, using `ResilientMediaImage`. `a` gets `target="_blank" rel="noopener noreferrer"`.
  - **Header:** a `SiteFavicon` with the host, `·` byline, and `·` "N min read" (the minimum is "1 min read"), muted, at 14px.
  - **Title:** the `h1` from `card.article.title`, falling back to the link title. The first `h1` in the Markdown is dropped when it equals the title.
  - **Footer:** a thin rule, then "Saved from {host} · {date}" and the link "Open original ↗". The date uses the existing `cardDetails` formatter.
- **Stage class:** for the Read view, `px-5 py-8 md:px-10 md:py-12`, with the column `mx-auto max-w-[68ch]`. The scroll position is kept per card while the modal is open.
- **The side panel** is unchanged in this phase. Phase 12 adds Highlights.

## API / MCP / SDK / CLI

- **`/v1/cards/{cardId}/content`:**
  - adds the optional query `kind`;
  - the `kind` enum gains `"article"`, and the description says article is Markdown with signed image URLs;
  - `400 VALIDATION_ERROR` for an unknown kind;
  - `404 NO_CONTENT` when that kind is missing.
- **Serializers** (`serializeCard`, `serializeListCard`) add `article`.
- **OpenAPI, MCP** (`teak_v1_get_card_content` gains `kind`), **SDK** (the `kind` union gains `"article"` and the validator at `sdk.ts:754` accepts it) and **CLI** (`--kind`). The `scripts/public-parity.ts` row is unchanged, because the operation is the same.
- **Older SDKs** throw on an unknown `kind` value (`sdk.ts:754`). Older CLI and SDK builds reading an article card get an error instead of text. Add a `.agents/sunset.md` entry, and note in the changelog that `teak` must be updated to read articles.

## Docs

- **`features.mdx`:** a "Read" subsection.
  - The tab, `R`, and what counts as an article.
  - Search covers article text.
  - Agents can read articles.
- **`api.mdx`, `mcp.mdx`, `(apps)/cli.mdx`:** `kind`, `article`.
- **Privacy policy line 41** (what AI processes) adds "the article text of saved pages (for summaries)".
- **Changelog:** "Read saved articles in Teak".

## UI states

- **Extracting:** Read is enabled and shows the skeleton with a muted line, "Preparing the article…". A live query flips it to the article without a reload.
- **Not an article** (`status: "none"`): the toggle is hidden and only Preview shows. If the user had picked Read on another card, that choice doesn't carry over.
- **Failed:** Read shows "Couldn't prepare this article." with a "Try again" text button, which runs Refresh details under its rate limit.
- **Text-only archive:** an article with no images; the reader looks the same.
- **Very long article** (512 KiB truncated): the footer adds "Article shortened to fit." above "Open original".
- **RTL and CJK:** the reader root gets `dir="auto"` and `lang={article.lang}`.
- **Width:** at 390 px the toggle sits under the header and the column has 20 px padding. At 1440 px the column is 68ch, centered in the stage, with the side panel to the right.
- **Light and dark:** body text uses foreground, links use `underline decoration-1 underline-offset-4`, blockquotes have a left border in `--border`, and inline code is on `bg-muted`.

## Scenario seed packs

- `reader-mix`:
  - a long-form article (3,000 words, with images, code, a table and a blockquote);
  - a news story;
  - a research abstract page;
  - a product page (status `none`);
  - a text-only archive article;
  - an RTL Arabic article;
  - a Japanese article;
  - a truncated 512 KiB article;
  - an extraction pending;
  - an extraction failed;
  - a podcast link with both an article and a transcript.

  The Markdown and image fixtures come from the stubbed archive objects in phase 9's `archive-mix`.
- `reader-search-1000`: 1,000 article cards whose titles share no words with a unique phrase that is only in their body text.

## Break-it checklist

- **UI:**
  - toggle with R rapidly;
  - press ←/→ to the next card while an article is loading (the old fetch is cancelled, and no flash of the wrong article);
  - open the reader, then Refresh details, then watch it update;
  - a signed image URL expired after 7 days (refetch on error);
  - 390 px with a wide table and a long URL inside a paragraph (no horizontal page scroll);
  - keyboard only;
  - screen reader headings order.
- **Sanitizing:**
  - Markdown containing raw `<script>`, `<iframe>`, `javascript:` links, and `![](javascript:…)`, all of which must be stripped;
  - a `teak-image:99` with no match, which renders nothing.
- **Search:**
  - a unique body phrase finds the card;
  - `type:link` with a body phrase;
  - trashed, archived and hidden cards follow the usual rules;
  - an article card plus document cards in one result set, within the read budget.
- **API:**
  - `?kind=transcript` on a card without a transcript returns 404;
  - an unknown `kind` returns 400;
  - another user's card returns 404;
  - the old CLI against an article card behaves as documented.

## Tests

- `apps/files-worker/src/archive/article.test.ts`: fixture pages to Markdown (headings, lists, tables, code, images numbered, `none` thresholds, RTL, Shift-JIS archive already decoded, image cap 20).
- `apps/files-worker/src/workflows/cardProcessing/run.test.ts`: the order of the new steps, `articleOnly`, the summary skipped under 200 words, and a failure that doesn't fail the card.
- `packages/convex/__tests__/card/articleText.test.ts`: row and card writes, old keys queued for deletion, idempotency.
- `packages/convex/documentText.test.ts` (convex-test): `getCardTextSource` with and without `kind`, and the article row.
- `packages/convex/__tests__/embedding/text.test.ts`: the link body comes from the article opening, and a URL in `content` is ignored.
- `packages/convex/searchQualifiers.test.ts` or a new `articleSearch.test.ts` (convex-test): body phrase search for links.
- `packages/convex/__tests__/publicApiHttpCards.test.ts`: content `kind` param, enum, errors.
- `packages/convex/__tests__/sdk.test.ts`, `__tests__/mcp.test.ts`, `apps/cli/src/commands.test.ts`.
- `packages/ui/src/components/card-previews/__tests__/ArticleReader.test.tsx`: renders the title, byline and "N min read"; removes a duplicate h1; maps `teak-image:`; strips scripts; renders the footer link.
- `packages/ui/src/components/card-modal/__tests__/CardModal.test.tsx`: the toggle appears only with an article, and the initial view follows the category rule.
- e2e: `packages/tests/src/web/reader.e2e.ts` opens an article card, switches to Read with `R` and sees the title heading. `journey/03-api.e2e.ts` reads `kind: "article"`.

## Proof before the PR

- **Video 1:** save a long article, watch "Preparing the article…" become the reader, then press R to go back and forth.
- **Video 2:** search a phrase that appears only in the body text and find the card. Then read the article through `teak cards content <id> --kind article`.
- **Screenshots:** the reader at 390 and 1440 px in light and dark, for an article with a table and code, an RTL article, and the failed, extracting and truncated states.
- **Numbers:** extraction p50/p95 time, the article Markdown size p50, the share of links that come out as `none`, and the summary step's added AI cost per 1,000 links.

## Release gate

1. Run the narrow tests, then the repo checks and the e2e specs listed.
2. Seed `reader-mix` and `reader-search-1000`. Run the break-it pass, and fix and add regression tests until it comes back clean.
3. Send the proof bundle to the owner.
4. Merge, then deploy the Files Worker, then Convex and web.
5. Run the `backfillArticles` dry run, then its pages once the owner approves.
6. Smoke-test production by reading an article in the web app and through the CLI.

## Risks And Open Questions

- **Chunked embeddings.** One vector per card can't represent a long article. Open decision (default: one vector from title, summary and opening). The alternative is up to 8 chunk vectors per article card, merged per card at query time. That costs about 8× the vectors for article cards, and needs a new Vectorize metadata field for the chunk index.
- **Regenerating the summary** costs a second AI call for each link of 200 words or more. Open decision (default: yes, summary only, never tags).
- **Default tab.** Open decision (default: Read for the `article`, `news` and `research` categories, Preview otherwise). The alternative is to always open on Preview.
- **Reader font.** Open decision (default: the app's SN Pro, with no new font). A serif reading face would need a new self-hosted font and a size budget.
- **Readability quality.** It misses some layouts (docs sites, forums). The `none` thresholds keep bad extractions out of the reader. Tune them with the proof numbers.
- **Worker bundle size.** `linkedom`, Readability and turndown add about 300 KB. Check them against the Worker size limit in the PR.
- **Old SDKs and CLIs** can't parse `kind: "article"`. It is documented, plus a sunset entry.
