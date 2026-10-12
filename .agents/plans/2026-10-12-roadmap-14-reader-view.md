## Goal

Add a clean Reader tab to link cards: the article text extracted when the link is saved (or on first open for older cards), sanitized, searchable, with reading time, a progress bar and per-device typography settings. Phase 14 of the [roadmap](2026-10-12-roadmap-00-roadmap.md).

## Depends on

- [Phase 13](2026-10-12-roadmap-13-stored-text.md) (`cardTextContents` for the searchable article prefix).

## Success Criteria

- New link cards with readable articles get a Reader tab; opening an older link card extracts the article on first open (rate-limited) and shows it when ready.
- Reader shows title, byline, reading time and body; scripts, iframes, forms and event handlers never reach the page; scroll position and progress are restored per card on the same device.
- Words from the article body are searchable.
- A failed or paywalled extraction never fails the link step and shows "Reader isn't available for this page" with Open original.
- Exports include `articles/<id>.html` for cards with an article.

## Context And Current Facts

- Correct path: the link step is `packages/convex/workflows/steps/linkMetadata/fetchMetadata.ts` (a `"use node"` action). `scrapeWithFetch` fetches the page through `safeFetch` + `pinnedFetch` and returns the HTML (capped at `MAX_REMOTE_HTML_BYTES = 2 MiB`) to `fetchMetadataHandler` (line 610), so the HTML is already in memory there (used at about line 719).
- X status URLs return early through `fetchXStatusMetadata` with no page HTML, so they get no article. Non-HTML content types return `html: null`.
- No reader dependencies are installed: `@mozilla/readability`, `linkedom` and `sanitize-html` are not in `packages/convex/package.json`; DOMPurify is not in `packages/ui` or `apps/web`. `htmlparser2` ^12 is already a Convex dependency.
- `CardModal.tsx` picks a preview component per type (`LinkPreview` for links). `packages/ui/src/components/ui/tabs.tsx` (Radix tabs) exists.
- R2 keys: `buildR2ObjectKey({ userId, cardId, role })`; `cardStorageObjectKeys` must list the article key for deletion.
- Export (Phase 11) hands the Files Worker inline entries and storage-key entries, so `articles/<id>.html` can be streamed from R2 by key.

## Constraints And Non-goals

- Extraction never fails the link step: wrap it, log, store `article.status: "failed"`.
- New R2 key (role `link-article`) added to `cardStorageObjectKeys`; `cards.article` and the `cardTextContents` row are covered by hard delete and account deletion like Phase 13.
- Searchable prefix goes through `cardTextContents` and `patchCardWithSearchSync`.
- No new workflow step: extraction lives inside the existing link metadata step. `reader/ensureArticle.ts` is an on-demand action for old cards, rate-limited in `shared/rateLimits.ts`.
- Sanitize twice: `sanitize-html` on the server before storing, DOMPurify in the browser before rendering.
- Reading settings and progress live in `localStorage` per device (guarded); no server sync.
- No API surface beyond Phase 13's content endpoint returning the article text for links.

## Backend

- Dependencies: `@mozilla/readability`, `linkedom`, `sanitize-html` in `packages/convex` (Node actions only); pin versions.
- `packages/convex/reader/extract.ts`: pure `extractArticle(html, url)` → `{ title, byline, siteName, html, text, wordCount }` or `null`; strips scripts, iframes, forms, styles and `on*` attributes; rewrites relative URLs; drops tiny or boilerplate results.
- `fetchMetadata.ts`: after a successful scrape, call `extractArticle`, store HTML in R2 (`link-article`), patch `cards.article { status: "ready" | "failed" | "unavailable", key?, wordCount, readingMinutes, extractedAt }`, and upsert the `cardTextContents` prefix (`kind: "article"`).
- `reader/ensureArticle.ts`: for a card with no `article`, refetch through the same safe fetch and extract; one call per card per minute, a per-user budget.
- `card/content.ts` (Phase 13): links return article text.
- `export/runExport.ts`: add `articles/<id>.html` storage-key entries.

## Web

- `CardModal.tsx`: Preview | Reader tabs for link cards when `article.status` is ready or unknown (unknown triggers `ensureArticle`).
- `packages/ui/src/components/card-modal/ReaderView.tsx`: DOMPurify, reading time, a thin progress bar, restores scroll per card, images lazy-loaded, links open in a new tab with `rel="noopener noreferrer"`.
- `packages/ui/src/components/card-modal/ReaderSettings.tsx`: font (serif or sans), size, line width, theme follows app; stored in `localStorage`.

## API / MCP / SDK / CLI

- No new endpoints. `GET /v1/cards/:id/content`, MCP `teak_v1_get_card_content` and `teak content` return `kind: "article"` for links with an article.

## Docs

- `features.mdx`: new "Reader" subsection.
- `(data)/export.mdx`: `articles/` folder.
- Ship-month changelog: "Read saved articles in Teak".

## UI states

- Empty: no Reader tab for non-link cards or X posts.
- Loading: on first open of an old card, a text skeleton (title bar plus paragraph lines) while `ensureArticle` runs.
- One item / many items: short articles hide the progress bar; very long articles keep 60fps scrolling.
- Very long names: long titles wrap; long unbroken URLs in the body break.
- Error: "Reader isn't available for this page." with Open original.
- Rate-limited: "Try again in a minute." on repeated opens of uncached cards.
- UI bar: Reader typography uses the existing type scale; settings in a popover, not a toolbar; correct in dark mode.

## Scenario seed packs

- `reader-articles`: fixtures served from a local file: a clean article, an article with scripts, iframes and inline `onerror`, a paywalled stub, a page with no article, a 2 MiB page, RTL and CJK articles, images with relative URLs.

## Break-it checklist

- UI: switch tabs fast; open the Reader on a card in two tabs; reload mid-scroll (position restored); change settings then reload; 390px reading; keyboard tab order inside the article.
- Backend: Readability fixtures table; XSS fixtures (script, `javascript:` links, SVG `onload`, `srcdoc`) produce no executable markup; paywall stub yields "unavailable"; extraction throwing does not fail the link step; `ensureArticle` rate limit; another user's card; deletion removes the R2 article.

## Tests

- `packages/convex/__tests__/reader/extract.test.ts`: fixture table (clean, scripts, iframes, paywall, empty, RTL, relative URLs); no `<script>`, `on*` or `javascript:` in output.
- `packages/convex/__tests__/workflows/steps/linkMetadata/fetchMetadata.test.ts`: article stored on success; extraction failure leaves the step successful.
- `packages/convex/__tests__/reader/ensureArticle.test.ts`: owner-only, rate limit, idempotent.
- `packages/ui/src/components/card-modal/__tests__/ReaderView.test.tsx`: sanitizes injected markup; reading time; restores scroll from storage.
- `packages/tests/src/web/reader.e2e.ts`: open a seeded article, switch to Reader, check text and progress.

## Proof before the PR

- Video: save an article link, open Reader, change typography, scroll, close and reopen (position kept); open an old card (on-demand extraction); a paywalled link (unavailable state).
- Screenshots: Reader light and dark, settings popover, unavailable state, loading skeleton; 390px and 1440px.

## Release gate

1. Narrow tests above, then the repo checks and `reader.e2e.ts`, `02-web-journey.e2e.ts`.
2. Seed `reader-articles`, run the break-it pass, fix and add regression tests. Run `/security-review` on the sanitization path.
3. Proof bundle as above.
4. PR, green CI, merge, deploy Convex then web. No backfill (old cards extract on open). Smoke-test production: save one article and read it.

## Risks And Open Questions

- Node bundle size and cold start grow with `linkedom` and Readability; measure the link step duration before and after.
- Content licensing: articles stay private to the owner; Phase 18 must not expose article HTML publicly without a decision.
