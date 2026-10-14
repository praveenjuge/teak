## Goal

Save social posts the way X posts are saved today: the post text, the author, the date and the media. This covers Bluesky, Mastodon, Reddit, Threads, TikTok, LinkedIn and Substack Notes, using public APIs or oEmbed where they exist and Open Graph otherwise. Phase 19 of the [roadmap v2](2026-10-14-roadmap-v2-00-roadmap.md).

## Depends on

- [Phase 18](2026-10-14-roadmap-v2-18-new-categories.md) (the `social_post` category and its URL rules).

## Success Criteria

- A public Bluesky, Mastodon or Reddit post is saved with its text, author, date and up to 10 images. A direct MP4 video of up to 50 MB is saved too.
- A TikTok link is saved with its caption, author and poster image. Threads, LinkedIn and Substack Notes are saved with their Open Graph text and image.
- A deleted, private or login-walled post, a rate-limited API or a timeout falls back to the normal page scrape. The card never fails because of the new fetchers.
- Every new request goes through `safeFetch` + `pinnedFetch`, including those to arbitrary Mastodon instances.
- Grid tiles and details show the media exactly as X posts do. There is no new UI.

## Context And Current Facts

- **Correction to the approved plan.** The X and Instagram pattern does not live in `steps/categorization/providers/`.
  - `packages/convex/linkMetadata/x.ts` (`isXStatusUrl`, `fetchXStatusMetadata`) and `instagram.ts` / `instagramHtml.ts` are called from `workflows/steps/linkMetadata/fetchMetadata.ts fetchMetadataHandler`.
  - The X branch (`:691`) runs before the generic `scrapeWithFetch`. Instagram media (`:776`) is read from the scraped HTML.
  - Categorization providers are synchronous selector readers and cannot fetch.
- `fetchXStatusMetadata` returns `XStatusMetadata`: `title` (post text, at most 512 characters), `description` (author · date), `author`, `siteName`, `publishedAt`, `media[]` and `finalUrl`. `buildSuccessPreview` turns it into `metadata.linkPreview`.
- X uses the global `fetch` against fixed hosts (publish.x.com, cdn.syndication.twimg.com), not `safeFetch`.
- **Media.**
  - `storeLinkPreviewMedia` (`fetchMetadata.ts:375`) downloads with `safeFetch` + `pinnedFetch` into the R2 roles `link-media-image`, `link-media-video` and `link-media-poster`.
  - The limits are `MAX_REMOTE_IMAGE_BYTES` = 20 MB and `MAX_REMOTE_VIDEO_BYTES` = 50 MB.
  - Media is stored in `linkPreview.media[]` (`schema.ts:174-190`, type image or video). `cardStorageObjectKeys` already covers it.
  - The grid uses the first attached image (`Card.tsx:~290`). The modal renders every item (`LinkPreview.tsx:256`).
- **SSRF.** `assertUrlIsSafe(normalizedUrl)` runs on the card URL before any fetch. `safeFetch(url, resolveDns, init, pinnedFetch)` and `readBodyWithLimit` are in `linkMetadata/ssrf.ts:361,421`, and `SAFE_FETCH_TIMEOUT_MS` is 30 s.
- A 429 from the generic scrape is thrown as retryable (`throwRetryable({ type: "rate_limit" })`), and a definitive 4xx stores a failed preview.

## Constraints And Non-goals

- One module per site in `packages/convex/linkMetadata/`, each with a pure URL matcher and an async fetcher. They return a shared `SocialPostMetadata`, the `XStatusMetadata` shape moved to `linkMetadata/socialPost.ts`, and `x.ts` re-exports it.
- A fetcher returns null for every failure, 429 included, and the handler then falls through to the generic scrape. Fetchers never throw retryable errors.
- JSON bodies are capped at 1 MiB with a 10 s timeout. At most 10 media items are kept, and only direct image and MP4 URLs. HLS streams keep the poster only, and nothing is transcoded.
- Text: `title` is the post text cut at 512 characters (as for X). `description` is the full text up to 4,000 characters when it is longer than the title, and the byline otherwise. `author` and `publishedAt` are set.
- Not in this phase: comment threads, reposts, accounts and logins, and fixing X to use `safeFetch` (separate cleanup).

## Backend

- `linkMetadata/bluesky.ts`: `bsky.app/profile/<handle|did>/post/<rkey>`.
  - Resolve the handle with `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle`.
  - Then call `app.bsky.feed.getPostThread?uri=at://<did>/app.bsky.feed.post/<rkey>&depth=0&parentHeight=0`.
  - Keep the record text, the author's `displayName`/`handle`, `createdAt`, and `app.bsky.embed.images#view` fullsize images. A video embed keeps its thumbnail.
  - A `!no-unauthenticated` label means private, so return null.
- `linkMetadata/mastodon.ts`: `https://<host>/@<user>/<id>` becomes `https://<host>/api/v1/statuses/<id>`.
  - The host is arbitrary, so use `safeFetch` only, and require the response's `url` to equal the card URL.
  - Strip the `content` HTML to text with `sanitizeText`, and keep the `spoiler_text` prefix.
  - Keep `media_attachments` of type image, gifv and video (direct MP4).
- `linkMetadata/reddit.ts`: `<permalink>.json?raw_json=1`.
  - Keep title plus selftext, `u/author`, `r/subreddit`, `created_utc`, `gallery_data`/`media_metadata` images and the `preview` image.
  - On 403 or 429, try `https://www.reddit.com/oembed?url=`, then fall through.
- `linkMetadata/tiktok.ts`: `https://www.tiktok.com/oembed?url=` gives the caption (`title`), `author_name` and `thumbnail_url` as a poster. No video download.
- `linkMetadata/threads.ts`, `linkedin.ts`, `substackNotes.ts`: Open Graph only. Map the generic scrape's `og:description`/`og:image` into the post shape (author from `og:title` or the URL handle). Threads oEmbed needs an app token, so it is not used. Check for an unauthenticated Substack Notes JSON endpoint during the build.
- `linkMetadata/socialPost.ts fetchSocialPostMetadata(url)`: the dispatcher. `fetchMetadataHandler` calls it after the X branch and before `scrapeWithFetch`. A hit stores media with `storeLinkPreviewMedia` and saves the preview the same way the X branch does. `SocialPostMetadata` also carries `platform` and a `categoryHint: "social_post"`. The dispatcher saves that hint on `metadata.linkPreview.categoryHint`, and the categorizer (`categorization/index.ts classifyStep`) uses it before the URL rules. A Mastodon status confirmed through `/api/v1/statuses/:id` on an instance outside phase 18's `MASTODON_HOSTS` allow-list is therefore stored as `social_post`. Any confirmed post from the other fetchers is too.

## Web

- No new components. Check that `Card.tsx` and `LinkPreview.tsx` render 10 images, video-only posts and text-only posts (the title tile) well.

## API / MCP / SDK / CLI

- No contract change. `linkPreviewTitle`, `linkAuthor`, `linkPublishedAt` and `linkPreviewMedia` already serialize. The OpenAPI descriptions name the supported sites.

## Docs

- `features.mdx`: a "Social posts" line under Card details listing the sites.
- The ship month's changelog: "Save posts from Bluesky, Mastodon, Reddit, TikTok and more".

## UI states

- Empty: a text-only post shows the text tile with the author byline.
- Loading: the existing processing skeleton.
- One item / many items: 1 image fills the tile, and 10 images show as a strip in the modal.
- Very long names: a 4,000-character Reddit post is clamped on the tile and the modal description, and stays fully searchable.
- Error: a deleted or private post shows the normal failed-preview state ("Couldn't load this page"), or the Open Graph result.
- Rate-limited: an API 429 silently uses Open Graph. No user-visible error.

## Scenario seed packs

- `social-posts`, as recorded fixtures under `packages/convex/__tests__/linkMetadata/fixtures/social/` and as seeded cards with prefilled previews:
  - a Bluesky post with 4 images, a video, a quote post and a `!no-unauthenticated` label
  - a Mastodon status with a content warning, gifv and video, plus a 404
  - a Reddit gallery of 10, an `over_18` post, a 5,000-character selftext and a removed post
  - a TikTok video
  - a Threads, a LinkedIn and a Substack note page
  - emoji-only, RTL and CJK posts

## Break-it checklist

- UI: a 10-image post at 390px, a video-only post, a 5,000-character text, and Refresh details on each.
- Backend:
  - a Mastodon URL on `127.0.0.1`, on `[::1]`, and on a host that redirects to `169.254.169.254`
  - an instance answering 10 MB of JSON, or the JSON of a different status
  - `<script>` inside Mastodon content
  - a Bluesky handle that does not resolve
  - 429, 500 and a timeout from each API
  - a media URL pointing at a private IP
  - more than 10 media items
  - a video over 50 MB

## Tests

- One file per site: `packages/convex/__tests__/linkMetadata/bluesky.test.ts`, `mastodon.test.ts`, `reddit.test.ts`, `tiktok.test.ts`, `threads.test.ts`, `linkedin.test.ts`, `substackNotes.test.ts`. Each covers URL matching, fixture parsing, the null cases and the size caps, with the network mocked.
- `packages/convex/__tests__/linkMetadata/ssrf.test.ts`: Mastodon hosts refused for private ranges.
- `packages/convex/__tests__/workflows/steps/categorization/index.test.ts`: a status confirmed on an unlisted Mastodon instance ends up `social_post` through `categoryHint`, and an unconfirmed `/@user/123` path on a blog stays `other`.
- `packages/convex/__tests__/workflows/steps/linkMetadata/fetchMetadata.test.ts`: dispatch order, falling through to the scrape on null, media stored through `storeLinkPreviewMedia`, and a 429 that never becomes retryable.
- `packages/ui/src/components/cards/__tests__/Card.test.tsx`: a text-only social post tile shows the author.

## Proof before the PR

- Video 1: on dev, save real public posts from Bluesky, Mastodon, Reddit and TikTok, and open each one.
- Video 2: a deleted Mastodon status and a private Bluesky post fall back cleanly.
- Screenshots of each site's tile and modal, the 10-image strip and long text. Each in light and dark, at 390px and 1440px.
- Logged fetch outcomes per site (hit, fallback or refused) from the dev deployment.

## Release gate

1. Run the narrow tests above, then the repo checks.
2. Seed `social-posts`, run the break-it pass, and fix and add regression tests until it comes back clean.
3. Send the proof bundle to the owner.
4. Open the PR. With CI green, merge and deploy Convex, then web. There is no Files Worker change and no backfill: existing posts improve on Refresh details.
5. Smoke-test production: save one public Bluesky post and one Mastodon status.

## Risks And Open Questions

- **Reddit.** Reddit often refuses unauthenticated server traffic (403 or 429), so its JSON may rarely work from Convex. The oEmbed and Open Graph fallbacks keep cards usable.
- **Thin sources.** Threads, LinkedIn and Substack Notes are Open Graph only, so they may show truncated text. A token-based Threads oEmbed is out of scope (it needs a Meta app).
- **Mastodon detection.** Detection is by path. Fork instances with other URL shapes fall through to Open Graph.
- **Inconsistency.** X keeps using the global `fetch`. Moving it to `safeFetch` is a separate cleanup.
