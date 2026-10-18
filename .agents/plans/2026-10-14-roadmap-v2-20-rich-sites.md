## Goal

Add richer details for Wikipedia articles, arXiv papers, Spotify and Apple Music links, and book links that carry an ISBN, using each site's public data. An arXiv card can also save its PDF as a document card. Phase 20 of the [roadmap v2](2026-10-14-roadmap-v2-00-roadmap.md).

## Depends on

- Phase 18 (new link categories, shipped): the category set is settled, so the new provider rules do not move again.

## Success Criteria

- **Wikipedia:** the short description, the lead image and the last edit date. The lead extract feeds the AI summary. A disambiguation page is labelled as one and gets no image.
- **arXiv:** authors, published date, primary subject and DOI as facts. The abstract feeds the AI summary. **Save PDF** creates a document card from the paper's PDF, through the web, API, MCP, SDK and CLI.
- **Spotify and Apple Music:** cover art and artist, plus the type (track, album, playlist or episode).
- **Books:** a book link with an ISBN (Goodreads, Amazon books, or a page with JSON-LD `Book.isbn`) gets author, pages, publisher, published date and ISBN from Open Library, plus its cover when the page has none.
- Every fetch fails soft. The card keeps today's details when a source is down, rate-limited or missing.

## Context And Current Facts

- **Providers cannot fetch.** `providers/index.ts enrichProvider` is synchronous over a `RawSelectorMap` built from scraped selectors.
  - The only async fetch in categorization is `fetchStructuredData` (JSON-LD, `safeFetch` + `pinnedFetch`, 500 KB) in `workflows/steps/categorization/index.ts`.
  - `enrichLinkCategory` is async (`"use node"`) and merges facts with `mergeFacts`, which deduplicates by label.
- **Existing rules.**
  - `linkCategoryResolver.ts:84`: `arxiv.org` maps to research, with no provider.
  - `:66-78`: open.spotify.com `/episode|/show` maps to podcast (provider spotify), other Spotify pages to music (spotify), music.apple.com to music (provider apple), and podcasts.apple.com to podcast (apple).
  - There is no Wikipedia rule.
  - `detectProvider` (`enrichment.ts:126`) returns `spotify` or `apple`, but no handler exists for either.
- **ISBN sources.**
  - `meta[property='books:isbn']` is already scraped (`linkMetadata/selectors.ts`, `GOODREADS_SOURCES`).
  - `STRUCTURED_DATA_FIELDS` (`enrichment.ts:10`) has no `isbn`, so JSON-LD `Book.isbn` is dropped.
  - The `book` case (`enrichment.ts:276`) adds Authors, Rating, Reviews, Length and Published.
- **AI input.** `workflows/steps/metadata.ts buildLinkContentParts` builds the summary input from the link preview only: title, description, author, publisher and date.
- **No remote-PDF path exists.** Files reach R2 only through signed uploads:
  - `storage/r2.ts generateUploadUrl` or `POST /v1/uploads`
  - then `card/uploadCardAction.ts finalizeUploadedCard`, with `finalize-upload` for non-images

  The quota is `card/quota.ts ensureCardCreationAllowed`, and duplicates are checked by URL through `cards.by_user_url_deleted`.
- Arbitrary-domain downloads must stay in Convex with pinned DNS (`.agents/convex-costs.md:65-68`).

## Constraints And Non-goals

- A new async layer, `workflows/steps/categorization/remote/`, holds one module per site. Each module is `fetch<Site>Details(sourceUrl, rawMap, category) → ProviderEnrichmentResult | null`.
  - Every request uses `safeFetch` + `pinnedFetch` and `readBodyWithLimit` (256 KiB), with a 10 s timeout.
  - `enrichLinkCategory` calls the layer after `enrichProvider`.
  - A null or a throw is ignored.
- Long text (an extract or abstract) goes in `linkCategory.raw.provider.summary`, never in a fact.
- Save PDF only accepts `https://arxiv.org/pdf/<id>` and `application/pdf` responses up to `MAX_FILE_SIZE`. It counts toward the card cap and the `cardCreation` rate limit.

## Backend

- `linkCategoryResolver.ts`: `*.wikipedia.org` with `/wiki/` maps to article, with provider `wikipedia`. arXiv gets provider `arxiv`. The Spotify and Apple rules stay.
- `remote/wikipedia.ts`:
  - It calls `https://<lang>.wikipedia.org/api/rest_v1/page/summary/<title>`.
  - Facts: About (`description`) and Updated (`timestamp`).
  - Image: `originalimage` or `thumbnail`. The summary is the `extract`.
  - `type: "disambiguation"` adds the fact `Page: Disambiguation` and no image.
- `remote/arxiv.ts`:
  - It accepts `/abs/<id>` and `/pdf/<id>` URLs, including old IDs like `hep-th/9901001`, and calls `https://export.arxiv.org/api/query?id_list=<id>`. The Atom response is parsed with `htmlparser2` `xmlMode`.
  - Facts: Authors (the first 3, then "et al."), Published, Subject and DOI.
  - The summary is the abstract, and `raw.provider.pdfUrl` is the PDF URL. A withdrawn paper gets no `pdfUrl`.
- `remote/spotify.ts`:
  - It calls `https://open.spotify.com/oembed?url=` and keeps `title`, `thumbnail_url` (the art) and the type taken from the path.
  - The artist comes from scraped `meta[name='music:musician_description']` or `og:description`. Add that selector to `selectors.ts`.
- `remote/appleMusic.ts`: no fetch. It reads JSON-LD `MusicAlbum`/`MusicRecording` (`byArtist`) and `og:image`. This is the `apple` provider handler for category music.
- `remote/openLibrary.ts`:
  - ISBN sources: the `books:isbn` selector, JSON-LD `isbn` (add `isbn` to `STRUCTURED_DATA_FIELDS`), or an Amazon `/dp/<ISBN-10>` path on a `book` card. The ISBN-10/13 checksum is validated.
  - It calls `https://openlibrary.org/isbn/<isbn>.json`, then up to 2 `/authors/<key>.json`.
  - Facts: Author, Pages, Publisher, Published and ISBN.
  - Cover: `https://covers.openlibrary.org/b/isbn/<isbn>-L.jpg?default=false`, only when there is no image yet.
- `metadata.ts buildLinkContentParts`: add `Summary: <raw.provider.summary>` (Wikipedia extract or arXiv abstract), cut to fit `MAX_AI_METADATA_INPUT_CHARS` (6,000).
- `card/saveLinkedPdf.ts`:
  - `saveLinkedPdf({ cardId })` is a session action. A `…ForUser` internal action backs the API.
  - It checks that the owner's link card has an arXiv `pdfUrl`.
  - A URL duplicate check can't work here: `createUploadedCardForUser` stores no top-level `url`, so the document never appears in `cards.by_user_url_deleted`. A `/pdf/` source card's lookup would also find the link card itself. Instead it records provenance in a new table, `linkedPdfs { userId, sourceCardId, pdfUrl, status: "pending" | "done" | "failed", cardId?, createdAt }` with `by_sourceCardId` and a reverse index `by_cardId`. Rows are deleted with the source card and in account deletion. When the generated document is hard-deleted, both hard-delete paths (`card/deleteCard.ts` and `workflows/cardCleanup.ts`) look the row up through `by_cardId` and clear it, with no table scan, so a later Save PDF creates a fresh document instead of returning the deleted one.
  - First an internal mutation claims the row atomically. A `done` row returns its `cardId` (`created: false`). A fresh `pending` row (under 2 minutes old) returns `409 IN_PROGRESS`, so concurrent calls never create two documents. A missing or `failed` row is (re)claimed as `pending`.
  - Then it checks the quota, downloads with `safeFetch`, stores to R2 (role `file`), and finalizes through the same promotion path as `finalizeUploadedCard`. The provenance claim (`{ linkedPdfId, claimToken }`) is passed into the card-creating mutation, which re-checks the claim, returns the existing `cardId` if the row is already `done`, and otherwise creates the document and marks the row `done` with its `cardId` in the same transaction. This matches phase 24's attachment pattern. The R2 destination key is derived from the `linkedPdfs` row id, so a retry after an interruption between storing and creating reuses the stored object instead of writing a second one. It returns `{ cardId, created: true }`. If the new document is later deleted, the row is cleared so Save PDF works again.
  - Any refusal before the document exists (quota, content type, size, or a failed download) marks the claimed row `failed` before it returns its error. An immediate retry then reclaims the row instead of getting `409 IN_PROGRESS`.
- Analytics: `link_pdf_saved { source }`.

## Web

- `card-previews/LinkPreview.tsx`: the new facts render in the existing grid.
- `CardMetadataPanel.tsx`: arXiv cards with a `pdfUrl` show **Save PDF** (`FileDown`).
  - While saving, the button shows "Saving PDF…".
  - Success shows the toast "PDF saved · Open". An existing card shows "Already saved · Open".

## API / MCP / SDK / CLI

- `POST /v1/cards/:id/save-pdf`:
  - It returns 201 `{ cardId, created: true }`, or 200 with `created: false` when the card already exists.
  - Errors: 400 when the card has no PDF, 402/403 at the card limit (the same code as create), 404 for another user's card, 429 when rate-limited.
  - It needs a `parseCardRoute` operation `save-pdf`. POST is already routed.
- MCP: `teak_v1_save_card_pdf`. SDK: `cards.savePdf(id)`. CLI: `teak cards save-pdf <id>`.
- The new facts flow through `linkFacts`. No other contract change.

## Docs

- `features.mdx` Card details: Wikipedia, arXiv, Spotify, Apple Music and book details, plus Save PDF.
- `(developers)/api.mdx`, `mcp.mdx`, `(apps)/cli.mdx`: save-pdf.
- The ship month's changelog: "Richer details for Wikipedia, arXiv, music and books".

## UI states

- Empty: a link with no match shows today's details.
- Loading: facts arrive with categorization. Save PDF shows "Saving PDF…".
- One item / many items: up to 8 facts. 300 arXiv authors become "A, B, C et al."
- Very long names: long titles wrap. A Japanese Wikipedia description wraps in the fact cell.
- Error: Save PDF failures show "Couldn't save the PDF. Try again." At the card limit the message is the same as for saving a card.
- Rate-limited: Save PDF uses `cardCreation` (30 a minute), with "You're saving quickly. Try again in a minute."

## Scenario seed packs

- `rich-sites`, as recorded fixtures under `packages/convex/__tests__/workflows/steps/categorization/fixtures/rich-sites/` and seeded cards:
  - Wikipedia: an English article, a disambiguation page, a Japanese article and a missing page
  - arXiv: a new-style ID with a PDF, an old-style ID, a withdrawn paper and a paper with 300 authors
  - Spotify: a track, an album, a playlist and a region-locked track
  - Apple Music: an album
  - books: a Goodreads book with an ISBN-13, an ISBN-10 only, no ISBN, a bad checksum, and an Open Library 404

## Break-it checklist

- UI:
  - Save PDF double-click (one card)
  - Save PDF at the free limit
  - Save PDF offline
  - facts at 390px
  - the Wikipedia image with a transparent background in dark mode
- Backend:
  - the Wikipedia title with `../` or encoded slashes (path-safe encoding)
  - an arXiv ID injection (`id_list=1,2`)
  - an oEmbed redirect to a private IP
  - a 2 MB Open Library response (cap)
  - a PDF URL answering `text/html`
  - a 200 MB PDF (refused)
  - Save PDF over quota, then again right away (the retry gets the quota error again, not `IN_PROGRESS`)
  - Save PDF on another user's card
  - Save PDF twice, one after the other (one card), and twice concurrently (one card, the other call gets `IN_PROGRESS` and then the same `cardId`)
  - Save PDF on a source card whose URL is already the `/pdf/` URL (creates a document, never returns the link card)
  - a timeout from each source

## Tests

- One file per site under `packages/convex/__tests__/workflows/steps/categorization/remote/`: `wikipedia.test.ts`, `arxiv.test.ts`, `spotify.test.ts`, `appleMusic.test.ts`, `openLibrary.test.ts`. Each covers fixture parsing, null cases and caps, with the network mocked. `openLibrary.test.ts` also checks the ISBN checksum.
- `__tests__/workflows/steps/categorization/index.test.ts`: the remote layer merges facts and ignores failures.
- `__tests__/workflows/steps/metadata.test.ts`: the summary appears in the AI input within 6,000 characters.
- `packages/convex/__tests__/card/saveLinkedPdf.test.ts`: owner only, provenance replay returns the same document, hard-deleting the generated document (through both hard-delete paths) clears its `linkedPdfs` row via `by_cardId` and the next Save PDF creates a new document, concurrent claims create one document, an interruption injected after card creation leaves the row `done` (a retry returns that card and writes no new R2 object), the `/pdf/` source URL case, deleting the document clears provenance, quota, content-type and size refusals, each followed by an immediate retry that is not blocked by `IN_PROGRESS` (R2 and network mocked).
- `__tests__/publicApiHttpCards.test.ts`, `__tests__/mcp.test.ts`, `__tests__/sdk.test.ts`, `apps/cli/src/commands.test.ts`.
- `packages/ui/src/components/card-previews/__tests__/LinkPreview.test.tsx`: the Save PDF button shows only with a `pdfUrl`.

## Proof before the PR

- Video 1: save a Wikipedia article, an arXiv paper (then Save PDF and open the document card), a Spotify album and a Goodreads book.
- Video 2: the nastiest cases: a disambiguation page, a withdrawn paper, Save PDF at the card limit, and a double-clicked Save PDF.
- Screenshots of each site's facts in light and dark, at 390px and 1440px.
- Captured `POST /v1/cards/:id/save-pdf`, MCP and `teak cards save-pdf` output.

## Release gate

1. Run the narrow tests above, then the repo checks and `journey/03-api.e2e.ts`, `04-cli.e2e.ts` and `05-mcp.e2e.ts`.
2. Seed `rich-sites`, run the break-it pass, and fix and add regression tests until it comes back clean.
3. Send the proof bundle to the owner.
4. Open the PR. With CI green, merge and deploy Convex, then web. There is no Files Worker change and no backfill: existing cards improve on Refresh details.
5. Smoke-test production on one card per site.

## Risks And Open Questions

- **Approved plan wording.** "Providers adding facts the same way" needs a new async layer, because the provider handlers cannot fetch.
- **Terms and limits.** The arXiv API asks for at most 1 request every 3 seconds per client. Bursts during an import could exceed it, so the arXiv module needs a per-deployment throttle (`shared/rateLimits.ts`), falling back to no facts.
- **Spotify and Apple Music.** Spotify oEmbed has no artist field, so the artist depends on Open Graph tags that Spotify may change. Apple Music has no public oEmbed, so it reads JSON-LD only.
- **Open Library coverage.** Data is uneven. Never overwrite facts the page itself provided, which `mergeFacts` already ensures by label.
