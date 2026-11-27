# Reader view

A link whose saved copy holds an article gets a **Preview · Read** toggle in the web card dialog. **Read** shows the article as Markdown: a header (site, byline, "N min read"), the title, the article, and a footer "Saved from {host} · {date} · Open original ↗". The workflow extracts it from the saved copy and rewrites the summary from it; search, the API, MCP, SDK and CLI read it.

## Sub-features

- `reader-toggle` shows only for a link with an article, being prepared or failed; it opens on Read for the article, news and research categories, Preview otherwise; `R` toggles; a pick never carries to the next card; each view keeps its scroll.
- `reader-render` shows the title once (a repeated opening heading goes) and renders GFM tables that scroll, fenced code, quotes and `teak-image:<n>` images with captions; links open in a new tab; scripts, frames and `javascript:` links are stripped.
- `reader-states` shows "Preparing the article…" with a skeleton, "Couldn't prepare this article." with **Try again** (Refresh details), "Couldn't load this article." with **Try again**, and "Article shortened to fit." above a cut article's footer.
- `reader-extract` runs "extract article" after "archive page" (also in archive-only and article-only runs), stores Markdown and WebP images under `article-text` and `article-image` or records `article: { status: "none" }` for a non-article. It drops page controls (a wiki's "[edit]" links, toggles such as "Read more Show less", anything acting as a button) but keeps a sentence's own "read more" link. A wiki article opens on its text, without "From Wikipedia, the free encyclopedia" or the MediaWiki body's `.noprint` lines, hidden short description and navigation boxes (other sites keep `noprint`/`navbox` content); an infobox (`table.infobox`) keeps its pictures on top and turns its rows into a "**Label:** value" list under its caption, between `---` rules after the opening paragraphs. Table cells keep the gaps between their lines ("Food energy (per 100 g serving)"; nested tables as "Protein 0.8 g; Fat 0.3 g"). A caption or link whose picture was dropped goes too.
- `reader-summary` rewrites `aiSummary` (not tags) from an article of 200+ words.
- `reader-search` finds a link by a phrase only in its article, with or without `type:link`.
- `reader-api` returns `article: { wordCount, readingMinutes }` on cards, and Markdown with signed image URLs from `GET /v1/cards/<id>/content?kind=article`, `teak cards content <id> --kind article`, MCP `teak_v1_get_card_content` with `kind`, and the SDK's `cards.content(id, { kind })`.

## How to get to it (user POV)

- A saved article's card opens on **Read**; `R` or **Preview** switches.
- `?` lists "Read or preview".
- Search a phrase inside a saved article.

## Driving it with e2e MCP and the API

Preconditions:

- Seed the packs on the signed-in account (on the dev deployment, drop the `env` prefix):
  `env -u CONVEX_DEPLOY_KEY CONVEX_AGENT_MODE=anonymous bunx convex run devSeed:seedScenario '{"workosUserId":"<id>","scenario":"reader-mix"}'`, then `reader-search-1000` with `"page"` 0–4.
- A live save's saved copy needs the link-fetch Container (not on the local E2E stack); without it, save through `POST /v1/page-snapshots/upload` and `pageSnapshotKey` ([Saved copies of pages](./page-archive.md)).

Steps:

- **States.** In `#scenario-reader`, "The patient garden: a long read" opens on Read with images, the planting table (scrolls sideways at 390 px, not the page), code and quote; "Garden hose, 25 m" has no toggle; "An article still being prepared" and "An article that couldn't be prepared" show their states; "A page too long to keep whole" ends with "Article shortened to fit."; the Arabic article reads right to left. Capture each, light and dark, at 390, 768 and 1440 px.
- **Toggle.** On a news card (Read), `R` twice (Preview, Read), `→` to the product card (no toggle), `←` back (Read). On the long read, scroll, `R` twice: the scroll holds.
- **Links.** Article links open a new tab; **Open original ↗** on a card whose page is gone opens its saved copy via `/open/<cardId>`.
- **No page controls.** On the dev deployment save `https://en.wikipedia.org/wiki/Bauhaus` (or Refresh details on the seeded "Bauhaus") and a Project Gutenberg book page. Neither Read nor `GET /v1/cards/<id>/content?kind=article` shows "[edit]" after headings or "Read more Show less" after the book's summary.
- **Live save.** Save a long article by page snapshot: "Preparing the article…", then the article, without a reload. `GET /v1/cards/<id>` gains `article.wordCount`.
- **Search.** `lantern137` and `"amber kestrel lantern" type:link`: matches come from article text only (titles are "Field note N").
- **API.** `GET /v1/cards/<id>/content?kind=article` returns `kind: "article"` and Markdown with `https://…/article-image/…` image URLs; without `kind` an article card answers `404 NO_CONTENT` (the podcast returns its transcript); `?kind=video` is `400 INVALID_INPUT`. `bun apps/cli/src/index.ts cards content <id> --kind article` prints it too.

- **Wiki articles.** Older articles, like the seeded "Tomato soup" and "Bauhaus", keep their Markdown until **Refresh details**. To test new extraction without deploying the Worker, sign the saved copy's URL (`getR2Url(card.pageArchive.storageKey)` via a throwaway, never-committed internal action on the dev deployment), run `extractArticle` on it locally with an `encodeImage` that returns its input bytes, and serve the result: `injectFaults(page, { rewriteQuery })` points the card's `articleUrl` and `articleImageUrls` at paths on the dev files host (the CSP refuses other hosts) and gives `article` a new `textKey` and matching `imageKeys`; `page.route` serves them with `access-control-allow-origin: *`. Read opens on the soup's picture and "Tomato soup is a soup…"; the facts list reads "Food energy (per 100 g serving): 30 kcal (130 kJ)".

## Gotchas

- The article follows the saved copy, the last step: allow a minute or more after a save.
- `reader-search-1000` has no Markdown in storage, so Read says "Couldn't load this article."; it is for search.
- Without `kind`, the content API never returns an article (older SDKs and CLIs rely on it).
- Native apps have no reader in v3.
