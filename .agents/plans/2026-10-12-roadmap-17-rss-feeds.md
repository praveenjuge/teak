## Goal

Let people subscribe to RSS, Atom and RDF feeds; Teak fetches them hourly and saves new items as link cards in a folder named after the feed, pausing cleanly when the card cap is reached. Phase 17 of the [roadmap](2026-10-12-roadmap-00-roadmap.md).

## Depends on

- [Phase 5](2026-10-12-roadmap-05-folders.md) (auto-folder per feed).

## Success Criteria

- Add up to 100 feeds by URL; the first fetch saves the latest 10 items, later fetches save at most 25 new items each.
- Items are deduplicated per feed (never saved twice, even after the card is deleted) and saved as link cards with `metadata.source: "rss"` and `feedId`, in the feed's folder, optionally tagged with the item's categories.
- Feeds fetch hourly with jitter using conditional GET (ETag / Last-Modified); "Fetch now" works on demand.
- When the free cap is hit, the feed shows "Paused: card limit reached" and resumes when space frees up or the user resumes it; broken feeds show an error status with the last error.
- `/v1/feeds` CRUD and fetch, MCP tools and CLI commands.

## Context And Current Facts

- Outbound fetching of arbitrary URLs must stay in Convex with pinned DNS (`.agents/convex-costs.md`): use `safeFetch` and `readBodyWithLimit` from `packages/convex/linkMetadata/ssrf.ts` with `pinnedFetch` from `workflows/steps/pinnedFetch.ts`, as `fetchMetadata.ts` does.
- `htmlparser2` ^12 is already a `packages/convex` dependency; its `xmlMode` handles RSS 2.0, Atom and RDF without a new parser library.
- Cron jobs are declared in `packages/convex/crons.ts` and dispatch internal functions under `telemetry/crons.ts`.
- Card creation goes through `card/createCard.ts` with the quota check (`card/quota.ts ensureCardCreationAllowed`, `FREE_TIER_LIMIT = 200`) and the `cardCreation` rate limit (30/min); URL dedupe exists via `cards.by_user_url_deleted`.
- `metadata.source` already exists on the card metadata validator (`schema.ts`), so `"rss"` needs no validator change.
- Folder deletion (Phase 5 `workflows/folderDeletion.ts`) must detach a feed whose auto-folder is deleted.

## Constraints And Non-goals

- New per-user tables `feeds` and `feedItems` go into `accountDeletionData.ts ancillaryPage`; `cards.feedId` is cleared (not the card deleted) when a feed is removed. Card hard delete leaves the `feedItems` row so the item is not re-imported.
- Fetch limits: 2 MiB body, 30 s timeout (`SAFE_FETCH_TIMEOUT_MS`), XML content types only, redirects through `safeFetch`.
- New cards go through `createCard`, so search sync, rules (Phase 16) and the processing workflow run as for any saved link.
- Cron: one dispatcher hourly that picks due feeds (`nextFetchAt <= now`) in bounded batches; per-feed jitter spreads load.
- No full-article fetching beyond what the normal link pipeline does; no OPML import in this phase.
- Public API order: `publicApiFeeds.ts` → `publicApiHttpFeeds.ts` → `executePublicApiOperation` → `http.ts` `/v1/feeds` and `/v1/feeds/` prefix with OPTIONS → `publicApiOpenApi.ts` → `mcp/tools.ts` → `client/sdk.ts` → CLI.

## Backend

- `schema.ts`:
  - `feeds { userId, url, title?, folderId?, tagCategories?: v.optional(v.literal(true)), status: "active" | "error" | "paused_limit" | "paused_user", etag?, lastModified?, lastFetchedAt?, nextFetchAt, lastError?, itemCount, createdAt, updatedAt }` with `by_userId`, `by_status_and_nextFetchAt`.
  - `feedItems { feedId, userId, guidHash, cardId?, createdAt }` with `by_feedId_and_guidHash`, `by_userId`.
  - `cards.feedId?: v.id("feeds")`.
- `feeds/parse.ts`: pure `parseFeed(xml)` → `{ title, items: [{ guid, url, title, publishedAt?, categories[] }] }`; resolves relative links; ignores items without an http(s) URL.
- `feeds/fetchFeed.ts` (Node action): conditional GET via `safeFetch`/`pinnedFetch`, 2 MiB cap, 304 handling.
- `feeds/ingest.ts`: dedupe by `guidHash`, first fetch keeps the latest 10, later fetches at most 25; create cards; on quota refusal set `paused_limit`; create the auto-folder on first ingest.
- `feeds/feeds.ts`: add (validates by fetching once), rename, set folder, toggle categories as tags, pause/resume, delete, fetch now (rate-limited).
- `crons.ts`: hourly `dispatchDueFeeds` with jitter.

## Web

- `packages/ui/src/components/settings/FeedsDialog.tsx`: list with status, last fetched time and item count; "Add feed" as the primary action; per-feed menu (Fetch now, Pause, Rename, Delete); paused-limit and error rows explain the fix.

## API / MCP / SDK / CLI

- `GET/POST /v1/feeds`, `GET/PATCH/DELETE /v1/feeds/:id`, `POST /v1/feeds/:id/fetch` (202).
- MCP `teak_v1_list_feeds`, `teak_v1_add_feed`, `teak_v1_update_feed`, `teak_v1_delete_feed`, `teak_v1_fetch_feed`; SDK `feeds.*`; CLI `teak feeds ls | add | rm | pause | resume | fetch`.

## Docs

- `features.mdx`: new "RSS feeds" subsection.
- `(developers)/api.mdx`, `mcp.mdx`, `(apps)/cli.mdx`.
- Ship-month changelog: "Follow RSS feeds".

## UI states

- Empty: "No feeds yet. Add a feed URL to save new posts automatically." with "Add feed".
- Loading: adding a feed shows "Checking feed…" on the button while the first fetch validates.
- One item / many items: 100 feeds list scrolls inside the dialog; cap message on the 101st.
- Very long names: long feed titles and URLs truncate with tooltips.
- Error: "Couldn't read this feed (not RSS or Atom)." on add; error rows show the last error and "Fetch now".
- Rate-limited: "Fetch now" disabled for a minute after use; "Paused: card limit reached" with an Upgrade link where upgrades are allowed.
- UI bar: one primary action; statuses as muted text, not badges.

## Scenario seed packs

- Feed fixtures served from a local file: RSS 2.0, Atom, RDF, a malformed XML feed, a 3 MiB feed (rejected), a feed with 500 items, relative links, duplicate GUIDs, items without links, CDATA and HTML in titles, emoji, RTL and CJK titles. Seeded `feeds` rows in each status, and an account at 195 cards for the cap pause.

## Break-it checklist

- UI: add the same feed twice fast; Fetch now repeatedly; delete a feed during a fetch; delete its folder; 390px dialog.
- Backend: parser fuzz over the fixtures; SSRF (private IPs, redirects to localhost, `file:`); 304 path; first fetch keeps 10; later ≤25; pause at 200 and resume; dedupe after the card is deleted; 101st feed; another user's feed ID; account deletion removes feeds and items; cron batch bounds.

## Tests

- `packages/convex/__tests__/feeds/parse.test.ts`: fixture table for RSS, Atom, RDF, malformed, relative links, categories.
- `packages/convex/feeds.test.ts` (convex-test, add to `vitest.config.ts`): ingest dedupe, first 10, later 25, pause at 200, resume, folder auto-create, folder delete detaches.
- `packages/convex/__tests__/feeds/fetchFeed.test.ts`: conditional headers, 304, size cap, SSRF refusal (network mocked).
- `packages/convex/__tests__/crons.test.ts`: dispatcher registered and bounded.
- `packages/convex/__tests__/publicApiHttpFeeds.test.ts` and `mcp.test.ts`.

## Proof before the PR

- Video: add an Atom feed, watch 10 cards appear in the feed's folder, Fetch now (no duplicates), pause at the cap, delete the feed.
- Screenshots: dialog empty, populated, error and paused rows; light and dark; 390px and 1440px.
- Captured `/v1/feeds` calls, MCP output, `teak feeds ls`.

## Release gate

1. Narrow tests above, then the repo checks and `03-api.e2e.ts`, `04-cli.e2e.ts`, `05-mcp.e2e.ts`.
2. Load the feed fixtures, run the break-it pass, fix and add regression tests.
3. Proof bundle as above.
4. PR, green CI, merge, deploy Convex (cron registers) then web. No backfill. Smoke-test production: add one public feed to a test account and confirm the first fetch.

## Risks And Open Questions

- Hourly fetching of many feeds adds Convex Node action time; batch size and jitter cap it. Watch function calls after launch.
- Feeds that rewrite GUIDs cause duplicates; dedupe also on canonical URL within a feed.
