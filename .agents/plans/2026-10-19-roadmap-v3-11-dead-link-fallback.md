## Goal

When a saved page has died, opening its link shows Teak's archived copy instead of an error page. When you open a link card that has an archive, Teak quickly checks the original first. If it is gone (404, 410, or the domain no longer resolves), the archived copy opens with a quiet "Archived copy" label. There is no background crawling. Phase 11 of the [roadmap v3](2026-10-19-roadmap-v3-00-roadmap.md).

## Depends on

- [Phase 9](2026-10-19-roadmap-v3-09-page-archive.md): only cards with a `pageArchive` take part. Every other card opens its link directly, as today.

## Success Criteria

- **Every web place that opens a link card's original URL goes through one helper,** `openCardLink(card)`:
  - the grid's "Open link" quick action;
  - the title and image anchors in `LinkPreview`;
  - the card modal's open-link handler;
  - the reader footer's "Open original ↗" (phase 10).

  For a card with an archive, the helper opens a new tab at `/open/<cardId>`. For any other card it opens the URL directly.
- **`/open/<cardId>`** is a signed-in web route that runs the check. It ends one of three ways:
  - **Alive or unsure:** `location.replace(originalUrl)`.
  - **Dead:** the archive viewer appears in the same tab, with a top bar reading "Archived copy · This page is no longer available · Saved 19 Oct 2026 from example.com · Try the original ↗".
  - **Not yours or missing:** "This card isn't available" with a link back to Teak.
- **What counts as dead:** HTTP 404 or 410 after redirects, or a domain with no A or AAAA records. Anything else counts as alive or unsure: 2xx, 3xx loops, 401, 403, 429, 5xx, timeouts, TLS errors, or a check that is rate-limited or fails. An error is never shown as dead.
- **Speed.** The check takes at most 4 s. After 1.5 s the page shows "Open the original now". Results are cached per card: alive for 24 hours (the next open skips the check and redirects at once), dead for 6 hours.
- **The card modal knows.** When the latest check said dead, `LinkPreview` shows an "Archived copy" chip beside the hostname, so the user knows before clicking.
- **No new API surface.** Agents and native apps keep opening `url` directly.

## Context And Current Facts

- **Where link cards open today:**
  - `cards/Card.tsx:300-305` `openLink` → `window.open(safeUrl, "_blank", "noopener,noreferrer")` (quick action "Open link", 543)
  - `card-previews/LinkPreview.tsx:328` and `:376` `<a href={safeUrl} target="_blank">` (the linked title and image block)
  - `hooks/useCardModal.ts:526` `openLink`
  - the reader footer from phase 10

  Each one sanitizes the URL with `sanitizeExternalUrl` (`shared/utils/safeUrl.ts`).
- **Web routes:**
  - `apps/web/src/app/(app)/{page,archive,f/[folderId],favorites,settings,tags,trash}`; `/archive` is already the Archive view, so the new route is `/open`.
  - AuthKit protects every route except `/sign-in`, `/sign-up`, `/callback`, `/opengraph-image` and the analytics proxy (`apps/web/src/proxy.ts:7-8`).
- **Safe fetching:**
  - `safeFetch` (`packages/convex/linkMetadata/ssrf.ts:351`) and the Files Worker's pinned hop (`apps/files-worker/src/pinnedHop.ts`) resolve DNS over DoH. An NXDOMAIN response returns no addresses (`pinnedHop.ts:52-55`).
  - Requests then go through the fetcher's `/hop`, which allows only the `accept` and `user-agent` request headers and returns at most 4 MiB, with a 30 s timeout cap (`fetcher/src/protocol.ts`).
- **Archive objects** are served from `files.teakvault.com` with phase 9's `Content-Security-Policy: sandbox` header for the `page-archive` role. Signed URLs come from `getR2Url` (`packages/convex/storage/fileUrls.ts`).
- **Rate limits** live in `packages/convex/shared/rateLimits.ts`.

## Constraints And Non-goals

- **Only a click starts a check.** No crawl and no periodic checker; the owner skipped the broken-link checker. No list of dead links.
- **Unsure means the original.** A false "dead" hides a live page behind an old copy, which is worse than a 404.
- **The archive renders only inside** `<iframe sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer">` from the files origin. There is no `allow-scripts` and no `allow-same-origin`, and the object's own CSP sandbox header also applies.
- **Popup blockers.** The helper always opens the new tab synchronously in the click handler, at `/open/<id>`, so the check never needs a second popup.
- **Middle-click** and "Copy link address" on the anchors still use the original URL. Only primary clicks and ⌘/Ctrl-clicks go through `/open`, because the anchors keep their real `href` and intercept `onClick`.
- **Not in this phase:** no soft-404 detection (such as a redirect to a homepage), no parked-domain detection, and no native apps, Raycast or extension. All of these are open decisions or later work.
- **Analytics:** add `dead_link_checked { outcome: "alive" | "dead" | "unsure" | "cached_alive" | "cached_dead", reason }` and `archived_copy_opened { surface }` to `shared/analytics.ts` first.

## Backend

- `schema.ts`: a new table, `linkChecks: { cardId, userId, outcome?: "alive" | "dead", httpStatus?, reason?, checkedAt?, checkingUntil? }`. Only alive and dead are stored; an `unsure` result is returned to the caller and never persisted, so it is retried on the next open. `checkingUntil` is the in-flight claim below. Indexes: `by_cardId` (unique per card) and `by_userId` (for deletion).
- `card/linkCheck.ts`:
  - **`checkCardLinkForOpen` action** `{ cardId }`:
    1. Load the card. If it is missing, not the caller's, or trashed, return `{ target: "unavailable" }`; the `/open` page shows its "This card isn't available" state. If it is the caller's link card with no `pageArchive`, return `{ target: "original", url }`.
    2. Read `linkChecks`. A fresh alive or dead result returns at once.
    3. Claim the check with a mutation that sets `checkingUntil = now + 5 s` only when no unexpired claim exists. A second open (a double click, two tabs) that finds a claim polls the row for up to 4 s and uses its result, or returns `original` if none arrives; it never spends a token or calls the worker.
    4. Spend the `linkChecks` rate limit (30 per minute per user). Over the limit, release the claim and return `original`.
    5. Call the Files Worker op `check-link { url }` with a 4 s signal.
    6. Write an alive or dead outcome and clear the claim; for `unsure`, only clear the claim. An alive outcome with the same status is not rewritten within 1 hour, to cut write churn.
    7. Return `{ target: "original" | "archive" | "unavailable", url?, archiveUrl?, capturedAt?, sourceHost? }`.
  - **`getLinkCheck` query** `{ cardId }` returns the latest dead outcome for the modal chip, or null.
- **Deletion:**
  - card hard delete removes the `linkChecks` row (beside `deleteCardTextRow` in the `searchDocumentHelpers.ts:280-299` cleanup);
  - account deletion pages over `by_userId` in `accountDeletionData.ts` `ancillaryPage`. Its batch's `length > 0` joins `ancillaryPage`'s continuation return (`accountDeletionData.ts`, the `return (cardLinks.length > 0 || …)` near line 202), so more than one page of rows is deleted; the test seeds more than 100 rows.
  - the "complete stages" test seeds a row.
- **`shared/rateLimits.ts`:** `linkChecks: { kind: "token bucket", rate: 30, period: MINUTE }`.

## Files Worker

- **The `check-link` op** (`FILES_OPS`, `ops.ts`, `apps/files-worker/src/linkCheck.ts`):
  1. Resolve the host with its own DoH lookup rather than `createDohResolver`, because that resolver returns an empty list both for NXDOMAIN and for a SERVFAIL or a lookup where one of A/AAAA failed (`pinnedHop.ts:49-72`). The host is `dead` (reason `dns`) only when both the A and AAAA queries succeed and both answer NXDOMAIN (DoH `Status: 3`). Any resolver error, SERVFAIL, timeout, or an empty answer with `Status: 0` is `unsure`. Otherwise it pins the addresses for the request as `pinnedHop` does. An SSRF refusal means `unsure` with the reason `blocked`.
  2. Send a `HEAD` request through `/hop`, following up to 5 redirects, each one re-checked. Where `HEAD` gets 405 or 501, send a `GET` and cancel the body after the headers.
  3. The final status maps 404 and 410 to `dead` and every other status to `alive` or `unsure` (2xx to alive, the rest to unsure).
  4. The total timeout is 3.5 s, and a timeout is `unsure`.
- It never touches R2, and it costs no Browser Rendering.

## Web

- **`packages/ui/src/lib/openCardLink.ts`:** `openCardLink(card, { appOrigin })` opens `${appOrigin}/open/${card._id}` in a new tab with `noopener` when `card.type === "link" && card.pageArchive`. Otherwise it opens the sanitized URL. It is used by `Card.tsx` `openLink`, `useCardModal` `openLink`, the `LinkPreview` anchors (an `onClick` that calls `preventDefault` for button 0 and for meta/ctrl), and the reader footer.
- **`apps/web/src/app/(app)/open/[cardId]/page.tsx`** (client) has three phases.
  - **Checking:**
    - a centered, quiet stack with the favicon, "Opening example.com…" in muted 14px, and a 120 ms fade-in so fast redirects show nothing;
    - after 1.5 s, an "Open the original now" text link appears;
    - the hard limit is 4 s, after which it goes to the original.
  - **Archive:**
    - a full-height layout. A 44px top bar (sticky, `border-b`, `bg-background`) holds, on the left, the `Archive` lucide icon and the "Archived copy" chip (`Badge variant="secondary"`), then muted text: "This page is no longer available · Saved {date} from {host}".
    - On the right: "Try the original ↗" (ghost button) and "Open in Teak", which goes to `/?card=<id>`, the existing card deep link read in `apps/web/src/app/HomePageClient.tsx:32`.
    - Below the bar, the sandboxed iframe fills the rest, on a white background in both themes, because archived pages bring their own colors.
    - At 390px the text after the chip is cut to "No longer available", and the two buttons collapse into a ⋯ menu.
  - **Unavailable:** "This card isn't available." with a "Back to Teak" link.
- **Modal chip:** `LinkPreview` takes an optional `linkState` prop from `useQuery(getLinkCheck)`, run only when the modal is open on a link card with an archive. When the state is dead, a small `Badge variant="outline"` reading "Archived copy" sits after the hostname, with the tooltip "The original page was gone when last checked on {date}".
- **Keyboard:** on `/open` in the archive state, `Esc` does nothing (it is a full page) and `⌘W` is the browser's own. The top bar buttons are reachable with Tab before the iframe.

## API / MCP / SDK / CLI

- None. The `scripts/public-parity.ts` row is not needed, because there is no public operation.

## Docs

- `features.mdx`, under the "Saved copies of pages" subsection from phase 9: "If a saved page disappears, opening it shows Teak's copy instead."
- The changelog for the month it ships: "Dead links open Teak's saved copy".

## UI states

- **Checking:**
  - an instant, invisible redirect for a cached alive result;
  - a quiet loading stack for a fresh check;
  - a slow-check link after 1.5 s.
- **Archive, full:** the page renders as captured, with images and fonts.
- **Archive, text-only:** the same top bar, plus a muted line at the start of the iframe page. The text-only document holds its own short "Text-only copy" heading, which phase 9's text-only writer adds.
- **Archive object missing** (deleted, or the signed URL failed): "Teak's copy couldn't be loaded." with "Try the original ↗".
- **Rate-limited:** goes straight to the original, with no message.
- **Very long host or title:** the top bar truncates with an ellipsis and never wraps to two lines.
- **Light and dark:** the bar follows the theme, and the iframe stays white.

## Scenario seed packs

- `dead-links`:
  - link cards with archives pointing at a 404 URL, a 410 URL, an NXDOMAIN domain, a 403 site, a 500 site, a slow site (6 s) and a live site;
  - a card with no archive pointing at a 404 URL (it must open directly);
  - a trashed card;
  - a text-only archive.

  The URLs point at a local test server in e2e, and at stable public test endpoints for the manual pass.

## Break-it checklist

- double-click "Open link" (two tabs are fine; only one rate-limit token per check while a check is in flight for the same card, deduplicated in the action);
- popup blocker enabled (the tab still opens, because it is synchronous);
- ⌘-click and middle-click on the anchor;
- go back from the archive view;
- reload `/open` while it checks;
- open `/open/<another user's card>`;
- open `/open/<garbage>`;
- signed out (AuthKit sign-in, then return);
- a 404 that redirects three times;
- a redirect to a private IP (unsure, never dead);
- an archived page that tries `window.top.location`, which the sandbox blocks;
- an archive containing a form `target=_top`;
- an archive with a `meta refresh`, removed in phase 9 and blocked by the sandbox anyway;
- 390px;
- keyboard only;
- slow network.

## Tests

- `apps/files-worker/src/linkCheck.test.ts`: a table over status codes, redirects, NXDOMAIN, SSRF refusal, the HEAD 405 fallback, and the timeout.
- `packages/convex/linkCheck.test.ts` (convex-test, add to `vitest.config.ts`):
  - the outcomes and the cache windows;
  - the rate limit;
  - cards that are not links, have no archive, are trashed or belong to someone else;
  - a deleted card's row removed;
  - the account deletion page.
- `packages/convex/accountDeletionWorkflow.test.ts`: seed `linkChecks`.
- `packages/ui/src/lib/__tests__/openCardLink.test.ts`: which URL opens for which card.
- `packages/ui/src/components/card-previews/__tests__/LinkPreview.test.tsx`: the chip appears only for dead, and the anchor `href` stays the original URL.
- e2e: `packages/tests/src/web/dead-link.e2e.ts` uses a local server that returns 404. It opens the card, sees the "Archived copy" heading in the new page, and the iframe has a `sandbox` attribute without `allow-scripts`.

## Proof before the PR

- **Video 1:** open a card whose page now 404s. The new tab shows "Opening…", then the archived copy with its bar. Then "Try the original ↗" shows the real 404.
- **Video 2:** open a live link twice. The first time goes through a brief check; the second redirects at once from the cache.
- **Screenshots:** the archive view (full and text-only), the slow-check state, and the modal chip, in light and dark at 390 and 1440 px.
- **Captured outcomes** for the status table.

## Release gate

1. Run the narrow tests, then the repo checks and `dead-link.e2e.ts`.
2. Seed `dead-links`, run the break-it pass, and fix and add regression tests until it comes back clean.
3. Send the proof bundle to the owner.
4. Merge, then deploy the Files Worker, then Convex and web.
5. Smoke-test production: open a known 404 card, then a live card.

## Risks And Open Questions

- **Soft 404s.** Some sites answer 200 with a "not found" page or a redirect to the homepage. Open decision (default: treat as alive). A later step could compare the final page title with the archived title.
- **The extra hop on every open.** Cards with archives (every link, after phase 9) go through `/open`, which costs about 300–800 ms on a first open per 24 hours. Open decision (default: as decided, check on click). The alternative is to check only when the card is at least 30 days old.
- **The archive view uses a white background in both themes.** Open decision (default: white, because pages bring their own colors).
- **Native apps, Raycast and the extension omnibox** still open originals directly. This is documented as later work.
