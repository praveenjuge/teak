# Reader view

A link with an article in its saved copy has a **Preview · Read** toggle in the card dialog on the web. **Read** shows the article as Markdown in one typographic default: a header (site, byline, "N min read"), the title, the article, and a footer "Saved from {host} · {date} · Open original ↗". The workflow's "extract article" step makes it from the saved copy, and "summarize article" writes the summary again from it. Search finds links by article text, and the API, MCP, SDK and CLI read it with `kind: "article"`.

## Sub-features

- `reader-toggle` shows **Preview · Read** only for a link with an article, or one being prepared or failed; it opens on Read for the article, news and research categories, on Preview otherwise; `R` toggles it; a pick never carries over to the next card; each view keeps its scroll.
- `reader-render` renders the header, the title once (an opening heading that repeats it goes), the article (GFM tables that scroll, fenced code, quotes, `teak-image:<n>` images with captions), and the footer; links open in a new tab; scripts, frames and `javascript:` links are stripped.
- `reader-states` shows "Preparing the article…" with a skeleton, "Couldn't prepare this article." with **Try again** (Refresh details), "Couldn't load this article." with **Try again**, and "Article shortened to fit." above the footer link of a cut article.
- `reader-extract` runs "extract article" after "archive page" (and in archive-only and article-only runs), stores the Markdown and WebP images under `article-text` and `article-image`, or records `article: { status: "none" }` for a page that isn't an article.
- `reader-summary` rewrites `aiSummary` (not the tags) from an article of 200 words or more.
- `reader-search` finds a link by a phrase only in its article, with or without `type:link`.
- `reader-api` returns `article: { wordCount, readingMinutes }` on cards and the Markdown, with signed image URLs, from `GET /v1/cards/<id>/content?kind=article`; `teak cards content <id> --kind article`, MCP `teak_v1_get_card_content` with `kind`, and the SDK's `cards.content(id, { kind })`.
- `reader-backfill` queues article-only runs for links with a copy and no article (`migration/backfillArticles`, dry run first).

## How to get to it (user POV)

- Open a saved article's card: it opens on **Read**. Press `R`, or click **Preview**, to see the link's preview.
- `?` lists "Read or preview" under the open card's shortcuts.
- Search a phrase from the middle of a saved article.

## Driving it with e2e MCP and the API

Preconditions:

- Seed the packs on the signed-in account (local stack shown; on the dev deployment, drop the `env` prefix):
  `env -u CONVEX_DEPLOY_KEY CONVEX_AGENT_MODE=anonymous bunx convex run devSeed:seedScenario '{"workosUserId":"<id>","scenario":"reader-mix"}'`, then `reader-search-1000` with `"page"` 0 to 4.
- A live save needs a saved copy first, which needs the link-fetch Container (not on the local E2E stack): save through `POST /v1/page-snapshots/upload` and `pageSnapshotKey` ([Saved copies of pages](./page-archive.md)) to get a copy, and so an article, without it.

Steps:

- **States.** Search `#scenario-reader`. "The patient garden: a long read" opens on Read with its images, the planting table (scroll it sideways at 390 px; the page itself must not scroll), the code block and the quote; "Garden hose, 25 m" has no toggle; "An article still being prepared" shows "Preparing the article…"; "An article that couldn't be prepared" shows "Couldn't prepare this article." and **Try again**; "A page too long to keep whole" ends with "Article shortened to fit."; the Arabic article reads right to left. Capture each in light and dark at 390, 768 and 1440 px.
- **Toggle.** Open a news card (Read), press `R` twice (Preview, Read), then `→` to the product card (Preview, no toggle) and `←` back (Read again: picks don't carry over). Scroll the long read, press `R` twice, and the scroll is where it was.
- **Links.** Click a link in the article: it opens in a new tab. Click **Open original ↗**: a card whose page is gone opens its saved copy through `/open/<cardId>`.
- **Live save.** Save a long article through a page snapshot; the toggle shows "Preparing the article…", then the article without a reload. `GET /v1/cards/<id>` gains `article.wordCount`.
- **Search.** Search `lantern137` and `"amber kestrel lantern" type:link`: the matches come from article text only (titles are "Field note N").
- **API.** `GET /v1/cards/<id>/content?kind=article` returns `kind: "article"` and Markdown whose images are `https://…/article-image/…` URLs; without `kind` an article card answers `404 NO_CONTENT` (or its transcript, for the podcast); `?kind=video` is `400 INVALID_INPUT`. `bun apps/cli/src/index.ts cards content <id> --kind article` prints the same Markdown.
- **Backfill.** `bunx convex run migration/backfillArticles:backfillArticles '{}'` (dry run) prints counts; `{"dryRun":false}` queues article-only runs.

## Gotchas

- The article comes after the saved copy, which is the last step: expect a minute or more after a save.
- `reader-search-1000`'s Markdown isn't in storage, so its Read tab says "Couldn't load this article."; it exists for search.
- Without `kind`, the content API never returns an article, so older SDKs and CLIs keep working.
- The native apps don't show the reader in v3.
