## Goal

Make adding feeds forgiving and portable. A YouTube channel URL finds that channel's RSS feed, any site URL finds its feed through `<link rel="alternate">`, and feed lists move in and out of Teak as OPML. Phase 25 of the [roadmap v2](2026-10-14-roadmap-v2-00-roadmap.md).

## Depends on

- [v1 phase 17](2026-10-12-roadmap-17-rss-feeds.md) (RSS feeds: `feeds` and `feedItems`, `feeds/parse.ts`, `feeds/fetchFeed.ts`, `FeedsDialog.tsx`, `/v1/feeds`, `teak feeds`).

## Success Criteria

- "Add feed" accepts:
  - a feed URL (as in v1 phase 17)
  - a YouTube channel URL in any form: `/channel/UC…`, `/@handle`, `/c/name` or `/user/name`
  - any web page that advertises a feed
- With one candidate, the feed is added directly. With several, the dialog lists them, and the user picks one.
- With none, the error is: "No feed found on this page."
- **OPML import:**
  - Import an OPML file in the feeds dialog, or with `POST /v1/feeds/opml`.
  - Outlines are flattened; categories are ignored.
  - Duplicates of existing feeds are skipped.
  - Import stops at the 100-feed cap from v1 phase 17, and the result reports added, skipped and failed counts.
- **OPML export:** export every feed as OPML 2.0 from the dialog, or with `GET /v1/feeds/opml`.
- SDK `feeds.importOpml` / `feeds.exportOpml` and CLI `teak feeds import <file>` / `teak feeds export [file]` work.

## Context And Current Facts

- **v1 phase 17 isn't built yet.**
  - Local `main` (`cbc71d2`) is at v1 phase 10. There is no `packages/convex/feeds/` directory, no `FeedsDialog.tsx` and no `/v1/feeds` route.
  - This phase extends the files that plan defines. Re-verify their real names when phase 17 merges.
  - v1 phase 17 explicitly leaves out OPML ("no OPML import in this phase").
- **Fetching rules.** Outbound fetches stay in Convex with pinned DNS:
  - `safeFetch` and `readBodyWithLimit` (`linkMetadata/ssrf.ts`, `SAFE_FETCH_TIMEOUT_MS` = 30 s)
  - `pinnedFetch` (`workflows/steps/pinnedFetch.ts`)
- **Parsing.** `htmlparser2` ^12 is a `packages/convex` dependency. It parses HTML `<head>` links and OPML XML (`xmlMode`), so no new library is needed.
- **YouTube.**
  - Channel pages include `<link rel="alternate" type="application/rss+xml" href="https://www.youtube.com/feeds/videos.xml?channel_id=UC…">`.
  - A `/channel/UC…` URL maps to that feed without a page fetch.
  - YouTube links are classified as `tv` (`shared/linkCategories.ts`). The YouTube enrichment handler arrives in v2 phase 21.
- **Rejected by the owner.** GitHub stars feeds; any new importer beyond v1 phase 12.

## Constraints And Non-goals

- Autodiscovery reads only the first 512 KiB of HTML and only `<link rel="alternate">` in `<head>`. MIME types: `application/rss+xml`, `application/atom+xml`, `application/rdf+xml` and `application/xml`. JSON Feed isn't supported (v1 phase 17 parses XML only), and no page-body crawling for `/feed` guesses.
- Every candidate is validated by `parseFeed` before it's offered, at most 5 per page.
- OPML import:
  - limits: 1 MiB, 500 outlines and depth 10
  - doesn't fetch every feed synchronously: rows are created `active` with `nextFetchAt = now + jitter`, and the hourly dispatcher validates them; parse errors move a feed to `error`
  - runs the import rate limit once per file
- No playlist feeds, no GitHub stars, and no folder mapping from OPML categories. Every feed still gets its own auto-folder (v1 phase 17).
- Public API order: `publicApiFeeds.ts`, then `publicApiHttpFeeds.ts`, then `executePublicApiOperation`, then `http.ts` (`/v1/feeds/opml` GET and POST plus `OPTIONS`, registered before the `/v1/feeds/` prefix), then `publicApiOpenApi.ts`, then `client/sdk.ts`, then the CLI. MCP gets no OPML tool, because files are awkward for agents. MCP `teak_v1_add_feed` gains discovery automatically.

## Backend

- `feeds/discover.ts` (pure plus one fetch):
  - `youtubeFeedUrl(url)` maps a `/channel/UC…` URL directly.
  - `discoverFeedLinks(html, baseUrl)` returns `[{ url, title? }]`, resolving relative and protocol-relative hrefs and de-duplicating them.
  - `resolveFeedInput(url)`:
    1. Fetch the URL.
    2. If it parses as a feed, return it.
    3. If it's HTML, discover the candidates and validate each with `fetchFeed` and `parseFeed`.
    4. Return `{ kind: "feed" } | { kind: "choose", candidates } | { kind: "none" }`.
- `feeds/feeds.ts addFeed`:
  - calls `resolveFeedInput`
  - with `choose`, throws `ConvexError({ code: "FEED_CHOICE_REQUIRED", candidates })`
  - stores `siteUrl?` on `feeds` (new optional field) for export `htmlUrl`
- `feeds/opml.ts` (pure):
  - `parseOpml(xml)` returns `[{ xmlUrl, title?, htmlUrl? }]`, ignoring outlines without `xmlUrl` or with a non-http(s) one
  - `buildOpml(feeds)` returns OPML 2.0 with escaped attributes
- `feeds/feeds.ts importOpml`:
  - skips duplicates by normalized URL against existing feeds
  - adds up to the cap
  - returns `{ added, skipped, failed, capped }`
  - is rate-limited by `feedOpmlImport` in `shared/rateLimits.ts` (3 per minute)
- Analytics: `feeds_opml_imported { added, skipped, failed }`, `feeds_opml_exported`, and `feed_added { via: "url" | "youtube" | "discovery" | "opml" }`.

## Web

- `FeedsDialog.tsx`:
  - The add field's placeholder becomes "Feed, site or YouTube channel URL".
  - With `FEED_CHOICE_REQUIRED`, an inline radio list of candidates appears (title and host), with "Add" as the one primary action.
  - The overflow menu gains "Import OPML…" (a file input, `.opml`/`.xml`) and "Export OPML". The export downloads `teak-feeds.opml`.
- Import result toast: "Added 12 feeds. 3 already followed, 1 couldn't be read." When the cap is hit, it adds: "Feed limit reached (100)."

## API / MCP / SDK / CLI

- `POST /v1/feeds` returns `422 FEED_CHOICE_REQUIRED` with `details.candidates` when a page has several feeds. The caller re-posts one candidate URL.
- `GET /v1/feeds/opml` returns `text/x-opml`. `POST /v1/feeds/opml` takes a raw OPML body (`application/xml` or `text/x-opml`, at most 1 MiB) and returns `{ added, skipped, failed, capped }`.
- MCP `teak_v1_add_feed` description mentions site and YouTube URLs, and returns the candidates on `FEED_CHOICE_REQUIRED`.
- SDK: `feeds.importOpml(xml)` and `feeds.exportOpml()`.
- CLI:
  - `teak feeds add <url>` prints numbered candidates and accepts `--pick <n>`.
  - `teak feeds import <file.opml>`.
  - `teak feeds export [file]` writes to stdout when no file is given.

## Docs

- `features.mdx` "RSS feeds": site and YouTube discovery, OPML import and export.
- `(developers)/api.mdx`, `mcp.mdx` (discovery behavior) and `(apps)/cli.mdx`.
- The ship month's changelog: "Follow YouTube channels and import your feeds with OPML".

## UI states

- Empty: as in v1 phase 17, plus an "Import OPML" link in the empty state.
- Loading: "Finding feed…" on Add while it resolves, and "Importing…" with the menu disabled during import.
- One item / many items: a site with 1 feed adds directly; with 3, the picker shows. 500 OPML outlines add up to the cap.
- Very long names: candidate titles and URLs truncate, with tooltips.
- Error: "No feed found on this page.", "This file isn't valid OPML." and "Couldn't reach this site."
- Rate-limited: "Too many imports. Try again in a minute."

## Scenario seed packs

- `feeds-extras`, local fixtures plus seeded `feeds` rows:
  - **YouTube:** `/@handle`, `/channel/UC…` and `/c/` pages; a channel page whose feed link is missing
  - **Sites:** one with 3 feeds (RSS, Atom, comments), one with relative and protocol-relative hrefs, one with no feed, one returning 404
  - **OPML:** valid, nested 5 deep, 500 outlines, malformed XML, a 2 MiB file, one with `javascript:` and `file:` xmlUrls, and duplicates of existing feeds
  - an account already at 98 feeds

## Break-it checklist

- UI:
  - paste a channel URL twice quickly
  - pick a candidate, then reload mid-add
  - import while another import runs (rate-limited)
  - import at 98 feeds
  - check at 390px with keyboard only
  - Export with 0 feeds produces a valid empty OPML
- Backend:
  - SSRF through discovered hrefs (private IPs, redirects to localhost)
  - OPML XXE and entity expansion (`htmlparser2` doesn't expand entities; assert this)
  - non-http xmlUrls dropped
  - cap enforcement across concurrent imports
  - another user's feeds never exported
  - account deletion still removes everything

## Tests

- `packages/convex/__tests__/feeds/discover.test.ts`: the discovery table (relative URLs, several candidates, none) and every YouTube URL shape.
- `packages/convex/__tests__/feeds/opml.test.ts`: parse and build round trip, malformed input, nesting, limits, escaping and entity safety.
- `packages/convex/feeds.test.ts` (extend): import dedupe and cap, `FEED_CHOICE_REQUIRED`, and stored `siteUrl`.
- `packages/convex/__tests__/publicApiHttpFeeds.test.ts`: OPML GET content type and POST size limit. `mcp.test.ts` covers the candidates.
- `apps/cli/src/commands.test.ts`: `feeds import`, `feeds export` and `--pick`.
- `packages/tests/src/journey/04-cli.e2e.ts`: an export then import round trip against the local stack.

## Proof before the PR

- Video 1: paste a YouTube `@handle` URL, see the channel's latest videos land in its folder, then paste a blog home page with three feeds and pick one.
- Video 2: import a 500-outline OPML into an account at 98 feeds, read the result toast, then export.
- Screenshots: the picker, import result, errors and empty state, in light and dark, at 390px and 1440px.
- Captured `GET/POST /v1/feeds/opml`, a `422` with candidates, and `teak feeds import` / `export` output.

## Release gate

1. Run the narrow tests above, then the repo checks, `03-api.e2e.ts`, `04-cli.e2e.ts` and `05-mcp.e2e.ts`.
2. Seed `feeds-extras`, run the break-it pass, and fix with regression tests.
3. Send the proof bundle.
4. Open the PR, get CI green, and merge. Deploy Convex (the optional `siteUrl` field), then web. No worker change and no backfill.
5. Smoke-test production: add a real YouTube channel by handle and a blog home page to a test account, then export and re-import (all skipped as duplicates).

## Risks And Open Questions

- YouTube may serve a consent or interstitial page to data-center IPs, especially from the EU. Fall back to scanning the page for `"channelId":"UC…"`. If that fails too, ask for the `/channel/` URL in the error copy.
- The `FEED_CHOICE_REQUIRED` error shape adds a new error code for the API and MCP. Old clients only see a `422` with a message, which is acceptable.
- Confirm the final file and function names once v1 phase 17 merges. This plan names them as that plan does.
