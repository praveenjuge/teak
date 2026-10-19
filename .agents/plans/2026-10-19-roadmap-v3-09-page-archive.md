## Goal

Keep a private, self-contained copy of every saved link's page, so the page outlives link rot and the reader (phase 10) has something to read. Every link gets one single-file HTML snapshot, made automatically on save on every plan, and existing links get one through a backfill. When you save from the Chrome or Firefox extension, the page as you saw it (rendered HTML, logged-in and paywalled pages included) becomes the snapshot. Phase 9 of the [roadmap v3](2026-10-19-roadmap-v3-00-roadmap.md).

## Depends on

- [Phase 2](2026-10-19-roadmap-v3-02-url-key.md): there is one archive per card, and re-saves (phase 3) reuse the card, so a re-save never makes a second archive.
- Nothing else. Phase 10 (reader), phase 11 (dead-link fallback) and phase 12 (highlights) build on this one.

## Success Criteria

- **Every new link card gets an archive.** The new last workflow step, "archive page", stores one `text/html` object under the role `page-archive`:
  - scripts are removed;
  - CSS, fonts and images are inlined as `data:` URIs, up to 20 MB in total;
  - video, audio, iframes and embeds are always dropped.

  Past the cap, images are dropped (the largest first) until it fits. If the HTML and CSS alone are still over 20 MB, the archive becomes **text-only**: a minimal HTML document holding the page's title and body text.
- **The card records the archive** in `cards.pageArchive`: `{ storageKey, bytes, kind: "full" | "text_only", source: "server" | "extension", capturedAt, sourceUrl }`. Processing has a new stage, `processingStatus.archive`, with the values pending, in progress, completed, failed or skipped. A failed archive never fails the card.
- **The Chrome and Firefox extension sends the page as you saw it.** For the popup auto-save, the keyboard shortcut (phase 1) and the right-click Save Page:
  1. It reads the tab's rendered DOM through `chrome.scripting.executeScript`.
  2. It gzips it and uploads it to a signed URL from `POST /v1/page-snapshots/upload`.
  3. It passes `pageSnapshotKey` in `POST /v1/cards`.

  The workflow then archives that HTML instead of fetching the page. A snapshot upload that fails never blocks the save.

  The snapshot is the page's markup as rendered. Its subresources (CSS, images, fonts) are still fetched by the server inliner, so on a logged-in or paywalled page the text is what you saw, but images or styles that need your session can be missing from the archive. The extension does not upload subresources in this phase.
- **A backfill** (dry run by default, paged) queues an archive-only run for every existing non-trashed link card. Before the production run, the owner gets the measured cost estimate (see Risks).
- **Refresh details re-archives the page.** Phase 12 adds the exception that a card with highlights is never re-archived.
- Nothing in the UI shows the archive yet, except one Details row in the side panel: "Archived copy · 2.4 MB". Phase 10 (Read tab) and phase 11 (dead-link fallback) are the surfaces that use it.
- **Deletion:** card hard delete, account deletion and `cardStorageObjectKeys` remove the archive object. Native apps keep working and ignore the new fields.
- **Privacy:** the privacy policy, the extension's store listings and the AMO data-collection declaration say that Teak keeps a copy of saved pages, and that the extension sends the page's content when you save.

## Context And Current Facts

- **Link processing order** (`apps/files-worker/src/workflows/cardProcessing/run.ts`):
  - "fetch link metadata" (245)
  - "categorize" (271)
  - "generate renderables" / "generate metadata" (289, 472)
  - "capture screenshot" (347–379; runs only when `metadata?.mode === "completed"`)
  - "read link image text" (381–391)
  - "emit completion" (393)
  - "transcribe podcast" (447, after completion; a failure never fails the card)

  New steps go at the end (`.agents/feature-conventions.md`).
- **Page HTML today:**
  - `fetchLinkPage` (`apps/files-worker/src/linkPage.ts:159-221`) asks the fetcher container for the static HTML. The fetcher caps a page at `MAX_PAGE_BYTES = 2 MiB` (`apps/files-worker/fetcher/src/fetchPage.ts:17`).
  - It returns `htmlGzipBase64` and caches the result for 24 hours in KV `LINK_PAGE_CACHE` (`LINK_PAGE_CACHE_TTL_SECONDS`, line 25) when the page is cacheable.
  - The HTML is used for scraping and for the screenshot, then dropped. Nothing keeps it.
- **Browser Rendering** (`apps/files-worker/src/browserRender.ts`):
  - `withPage` (14–51) aborts every network request and disables WebSocket, EventSource and `sendBeacon`. It only `setContent`s the static HTML, at most `MAX_RENDER_HTML_BYTES = 2 MiB` (11).
  - So today Teak never runs a page's JavaScript and never loads its subresources. That is the safe default the archive keeps for server captures.
- **Fetching assets safely:**
  - The fetcher image has `/fetch` for images and video (`FilesRemoteAssetKind = "image" | "video"`, 20 MB image cap; `packages/files-protocol/src/remoteAsset.ts:1-9`) and `/hop` for any one SSRF-checked request (`FETCHER_HOP_MAX_BYTES = 4 MiB`, `FETCHER_HOP_MAX_TIMEOUT_MS = 30 s`; `fetcher/src/protocol.ts`).
  - At most `FETCHER_MAX_IN_FLIGHT = 4` downloads run at once per instance.
- **Storage:**
  - Object keys are `<env>users/<user hash>/cards/<card id | pending>/<role>/<id>[-name]` (`packages/files-protocol/src/storage.ts:50-78`).
  - `cardStorageObjectKeys` (`packages/convex/storage/cardObjectKeys.ts`) lists every key a card owns.
  - Stale `pending/` uploads are swept by `sweepStalePendingUploads` (`apps/files-worker/src/queues/r2Events.ts`, run from `cron.ts:166-199`).
- **Files are served from `files.teakvault.com`** (`FILES_PUBLIC_ORIGIN`, `wrangler.jsonc:217`), a different origin from the app. `applyObjectHeaders` (`apps/files-worker/src/index.ts:277-304`) sets `nosniff` and allows any origin for signed URLs. It sets no CSP.
- **Extension:**
  - Has `scripting`, `tabs` and `<all_urls>` (`apps/extension/wxt.config.ts:53-61`).
  - Already calls `chrome.scripting.executeScript` for Save Text (`entrypoints/background.ts:288`).
  - `saveToTeak` (`lib/saveToTeak.ts:88-140`) checks `/v1/cards/duplicate` and then calls `POST /v1/cards` with an Idempotency-Key.
  - The `SAVE_CONTENT` validator only allows the `source` values `popup-auto-save` and `context-menu` (`background.ts:351`). Phase 1 adds the shortcut's.
  - Safari is a separate native extension (`apps/apple/SafariExtension`, permissions activeTab, nativeMessaging, storage) that saves through the app's session.
- **The thumbnail upload** is the pattern to copy for a signed upload followed by an attach: `POST /v1/cards/{cardId}/thumbnail/upload`, then `PUT …/thumbnail` (`publicApiOpenApi.ts:1511-1614`, `card/thumbnailOverride.ts`).
- **Refresh details** calls `reprocessCardForUserHandler` (`packages/convex/card/updateCard.ts:640-656`): `queueCardProcessing(ctx, cardId, { refresh: true, reset: true })`, rate-limited by `spendCardReprocessLimits`.
- **Privacy policy** (`apps/docs/content/docs/(legal)/privacy-policy.mdx`):
  - line 23, capture data: "the page URL, title, or text you choose to save";
  - line 41, what AI processes;
  - line 137, browser extension: "reads the current tab's address, title, or selected content when you save … It doesn't track your browsing."
- **Licence:** Teak is MIT. SingleFile (a common open-source page-archiving engine) is AGPL-3.0, and monolith is a Rust CLI that can't run in a Worker. Neither is used.

## Constraints And Non-goals

- **Licence.** No AGPL code. The inliner is Teak's own, built on `HTMLRewriter` in the Files Worker. The extension sends the DOM as it is and does no inlining in the browser.
- **The server never runs a page's JavaScript.** It archives the static HTML (the 2 MiB fetcher page) plus its inlined subresources. JS-heavy pages archive well only when saved from the extension. A server-side live render is an open decision.
- **The archive is never shown as a live page in Teak's origin.** Phase 11 shows it in a sandboxed iframe from `files.teakvault.com`, with `Content-Security-Policy: sandbox` (no `allow-scripts`, no `allow-same-origin`).
- **Scope:**
  - No "Open archived page" button and no archive download (the owner chose only the dead-link fallback as a surface).
  - No archive in the account export.
  - No native app UI.
- **Every plan, no quota.** The free plan's 200-card cap is the limit.
- **Analytics:** add `page_archived { kind, source, bytesBucket, durationMsBucket }` and `page_archive_failed { reason, source }` to `shared/analytics.ts` first.

## Backend

- `schema.ts`, on `cards`:
  - `pageArchive: v.optional(v.object({ storageKey: r2KeyValidator, bytes: v.number(), kind: v.union(v.literal("full"), v.literal("text_only")), source: v.union(v.literal("server"), v.literal("extension")), capturedAt: v.number(), sourceUrl: v.string() }))`
  - `pendingPageSnapshotKey: v.optional(r2KeyValidator)` and `pendingPageSnapshotAt: v.optional(v.number())`, holding the extension's upload, and when it was taken, until the workflow uses it.
  - `processingStatus.archive` in the stage map, with the same `stageCompleted` and `stageFailed` helpers.
- `storage/cardObjectKeys.ts`: add `card.pageArchive?.storageKey` and `card.pendingPageSnapshotKey`.
- `workflows/steps/archive/mutations.ts`, both guarded by `{ cardId, rev }` and listed in `workflowRpcAllowlist.ts`:
  - `recordPageArchive({ cardId, archive })` replaces `pageArchive` through `patchCardWithSearchSync`. The archive is not searchable here (phase 10 adds the text), but a single write path keeps it simple. It queues the old archive object for deletion with `queueObjectDeletion` only when its key differs from the new one (a refresh of an unchanged page produces the same content-hash key, and deleting it would delete the new archive), and clears `pendingPageSnapshotKey` after queuing that object's deletion too.
  - When the guard rejects `recordPageArchive` (a stale run, or a card deleted meanwhile), the step deletes the object it just wrote. The output key is also registered with `ensureObjectOwnership` before the worker writes it, so the orphan sweep can find it if that compensating delete is lost.
  - `markPageArchiveStage({ cardId, status, reason? })`.
- `card/createCard.ts` / `raycast.quickSaveForUser`:
  - accept an optional `pageSnapshotKey`;
  - validate that it is one of the caller's pending uploads (see the next item);
  - store it in `pendingPageSnapshotKey`, with `pendingPageSnapshotAt` set to the save time.

  A key that is wrong, foreign or missing is ignored, not refused, so a bad snapshot never loses a save. On re-save (phase 3), a fresh snapshot replaces the old archive only when the card has no highlights (phase 12).
- `publicApiPageSnapshots.ts`: `createPageSnapshotUpload(userId, { bytes })` returns a signed PUT URL in the existing pending-upload namespace, `buildR2ObjectKey({ userId, cardId: PENDING_UPLOAD_CARD_ID, role: "page-snapshot" })` (`storage/r2.ts:18`, `upload-pending-v2`), and registers ownership first, as `publicApiUploads.ts` does. The R2 event queue (`queues/r2Events.ts`, `PENDING_UPLOAD_SEGMENT`) and the orphan sweep already clean up abandoned objects there, so a snapshot whose card POST never arrives is removed like any other abandoned upload. It refuses anything over 20 MiB of compressed bytes with 413 `PAGE_SNAPSHOT_TOO_LARGE`, and is rate-limited by a new `pageSnapshotUploads` limit of 60 a minute.
- `migration/backfillPageArchives.ts`:
  - pages through the whole `cards` table in `_creationTime` order (copy `migration/backfillUrlHost.ts`), for link cards with no `pageArchive` and no `processingStatus.archive.status === "failed"`;
  - queues `queueCardProcessing(ctx, cardId, { archiveOnly: true })`;
  - `dryRun` defaults to true and returns counts per user and in total;
  - 50 cards per page, and each page schedules the next only after the dispatcher's queue depth is under a threshold, so the backfill never starves new saves.
- `workflowDispatch.ts` / `CardProcessingParams`: add `archiveOnly?: true`. That run goes straight to the "archive page" step.

## Files Worker

- `apps/files-worker/src/archive/inline.ts`: `buildPageArchive({ html, pageUrl, budgetBytes = 20 MiB, fetchAsset, fetchText, images })`.
  1. **Strip** with `HTMLRewriter`:
     - `script`, `noscript` (its children are kept), `iframe`, `frame`, `object`, `embed`, `video`, `audio`, `source`, `track`, `portal`;
     - `link[rel=preload|prefetch|modulepreload|manifest]`, `meta[http-equiv=refresh]`, `base`;
     - every `on*` attribute, and any `javascript:` or `data:text/html` `href`/`src`;
     - `<form action>` becomes inert.
  2. **Rewrite every `href` to absolute** against `pageUrl`, with `target="_blank" rel="noopener noreferrer"`.
  3. **CSS:**
     - fetch each `link[rel=stylesheet]` through `/hop` (4 MiB each, 40 stylesheets at most), within a shared input budget for the whole archive (see 5);
     - resolve `@import` one level deep;
     - inline it as `<style>`;
     - rewrite `url()` fonts (woff2 first) and images to `data:` URIs within the budget.
  4. **Images:**
     - for each `img`, pick one candidate from `srcset`/`src`/`data-src` (the widest at or under 1600w);
     - fetch it through `/fetch` (image), and re-encode wider images to 1600w WebP through the `IMAGES` binding (`imagesBinding.ts`, 20 MB input cap);
     - inline it; `picture > source` is replaced by the chosen `img`;
     - inline CSS background images last.
  5. **Budget:**
     - **Input:** at most 200 subresource requests and 60 MiB of fetched bytes per archive, across CSS, fonts and images; once either is reached, nothing more is fetched and the rest are treated as dropped.
     - **Output:** fetch and size every image candidate first, then drop images largest-first until the whole archive fits in 20 MiB. Each dropped image keeps `alt`/`width`/`height` in an empty placeholder box (`data-teak-dropped`).
  6. **Text-only:** if the stripped HTML plus CSS is still over budget, write a minimal document from a body-text pass with `<h1>`–`<h6>`, `<p>`, `<li>`, `<blockquote>`, `<pre>` and `<a>` kept. The result is `kind: "text_only"`.
  7. **Header:** prepend `<meta charset="utf-8"><meta name="teak-archive" content="…">`, where the content is the JSON `{"url","capturedAt","source"}` HTML-attribute-escaped (`&`, `"`, `'`, `<`, `>`), so a URL with quotes or markup can't break out of the attribute, and a CSP meta that denies scripts: `default-src 'none'; img-src data:; style-src 'unsafe-inline' data:; font-src data:; media-src 'none'`.
- **The new op `archive-page`** (in `FILES_OPS` and `ops.ts`):
  - **params:** `{ cardId, userId, url, snapshotKey? }`;
  - **source:** with `snapshotKey`, read and gunzip it (cap 20 MiB compressed / 60 MiB raw); otherwise call `fetchLinkPage` for the cached static HTML;
  - **output:** run `buildPageArchive`, `PUT` the result to `cards/<cardId>/page-archive/<sha256>.html` with `Content-Type: text/html; charset=utf-8`, and return `{ storageKey, bytes, kind, source }`.
  - **`applyObjectHeaders`:** for a key whose role is `page-archive`, also set `Content-Security-Policy: sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline' data:; font-src data:` and `Cross-Origin-Resource-Policy: cross-origin`. Even when opened directly, the copy then runs in an opaque origin with no scripts.
- **`run.ts`:** append an "archive page" step after "transcribe podcast" for `cardType === "link"`, whether or not AI metadata completed.
  - Earlier steps can end the run before it (a link-metadata failure outside a refresh rethrows, `run.ts:260`). So when a link card's run ends in failure, the workflow's failure path dispatches a separate `archiveOnly` run for it, the same run the backfill uses; a page that can't be fetched then fails only its archive stage.
  - Retries: 3, with 30 s delay for `renderer_unavailable`/busy; timeout 5 minutes.
  - A final failure runs "mark archive failed", and the card still completes.
  - The step skips when `pageArchive` exists, unless this run is a refresh, or `pendingPageSnapshotAt` is newer than `pageArchive.capturedAt`.
  - With `archiveOnly`, only "load card" and "archive page" run.
- **Deploy order:** the Files Worker ships before Convex. An old Convex never sends `archiveOnly`, and the new step is a no-op for cards it can't load.

## Extension

- **`lib/pageSnapshot.ts` `capturePageSnapshot(tabId)`:**
  - `chrome.scripting.executeScript` with a function that clones `document.documentElement` and removes `script`, `noscript` and `template`;
  - it sets each form control's value attribute from its live value, except `input[type=password]`, hidden inputs and any field with `autocomplete` of `current-password`, `new-password`, `one-time-code` or a `cc-*` value, whose values are cleared, so a snapshot never stores credentials or card numbers typed into the page;
  - it adds `<base href=location.href>`, and returns `outerHTML` together with `location.href`;
  - it gzips the result with `CompressionStream`, skips it above 20 MiB compressed, and gives up after a 3 s timeout.
- **`saveToTeak`:**
  - when given a snapshot, it calls `POST /v1/page-snapshots/upload` and then `PUT` to the signed URL;
  - it passes `pageSnapshotKey` in the `POST /v1/cards` body;
  - the duplicate path (phase 3 re-save) also passes it;
  - any snapshot error is logged and dropped, and the save goes on without it.
- **Where it runs:**
  - the popup auto-save (`hooks/useAutoSaveUrl.ts` → `SAVE_CONTENT`), the phase 1 shortcut, and the context menu's Save Page;
  - not Save Text or Save Asset, not inline post buttons (their pages are feeds), and not `restrictedUrl` pages.
- **Safari** keeps server-only archives in this phase. Its manifest has no `scripting`.
- **Popup copy:** none. The archive is invisible at save time.

## API / MCP / SDK / CLI

- **`POST /v1/page-snapshots/upload`:**
  - request `{ bytes }`, response `{ uploadUrl, fileKey, method: "PUT", expiresIn, maxFileSize }`, shaped like the thumbnail upload;
  - it goes in `publicApiOpenApi.ts`;
  - in `scripts/public-parity.ts`, MCP and the CLI are left out with the reason "browser capture only", and the SDK gets `pageSnapshots.createUpload`.
- **`POST /v1/cards`** and bulk `create` accept an optional `pageSnapshotKey`.
- **Card serializers** add `archive: { kind, bytes, capturedAt } | null`. No URL: the HTML stays in the app.
- **Docs:**
  - `api.mdx` gets the new op and field, and a sentence: "Teak keeps a private copy of each link's page".
  - The MCP and CLI docs are unchanged, apart from the `archive` field in `cards get --json`.

## Docs

- `content/docs/features.mdx`: a new "Saved copies of pages" subsection.
  - Every link is archived.
  - What is kept: text, styles and images, up to 20 MB.
  - What isn't: video, audio and scripts.
  - Saving from the extension keeps the page as you saw it.
- `privacy-policy.mdx`:
  - **line 23:** add "and, when you save from the Chrome or Firefox extension, the page's content as it appears in your browser";
  - **line 41:** no change (the archive is not sent to AI in this phase);
  - **line 137:** "when you save a page, it also sends that page's content, so Teak can keep a copy" (the sentence "It doesn't track your browsing" stays);
  - **retention:** a new line saying archives are deleted with the card.
- `apps/extension/release.md`: update the Chrome Web Store privacy-practice answers ("Website content": collected, for app functionality) and the AMO `data_collection_permissions`. `websiteContent` is already declared (`wxt.config.ts:46`).
- The changelog for the month it ships: "Teak keeps a copy of every page you save".

## UI states

- **Side panel Details** (`CardMetadataPanel.tsx`, Details section at 422):
  - completed archive: one row, "Archived copy" with the size ("2.4 MB"), or "Text only" for `text_only`;
  - pending or in progress: "Saving a copy…", with a 12px skeleton bar;
  - failed: "Couldn't save a copy", with a muted info tooltip giving the reason (blocked page, too large, unreachable).
- **No toasts** for archive progress. It is quiet background work.
- **Long values:** the size row never wraps. Very long source URLs are never shown here.

## Scenario seed packs

- `archive-mix`: link cards in each state, with stub objects:
  - `full` (a 40 KB fixture with inlined images);
  - `text_only`;
  - failed (`blocked_url`, `too_large`);
  - pending;
  - an extension-sourced archive;
  - a trashed card with an archive;
  - a podcast link with an archive and a transcript.
- `archive-backfill-1000`: 1,000 link cards with no `pageArchive`, in pages.
- Inliner fixtures (in tests, not seeds):
  - a page with 300 images totalling 60 MB;
  - CSS `@import` loops;
  - a font-heavy page;
  - a page whose `<img>` points at `127.0.0.1` or a `file:` URL;
  - `srcset` with only x-descriptors;
  - an RTL Arabic article;
  - a CJK page in Shift-JIS;
  - a 2 MiB HTML page with inline base64 already;
  - a JS-only SPA shell (the server archive is near-empty, the extension archive is full).

## Break-it checklist

- **Extension:**
  - save a logged-in Gmail-like page, then check that the archive holds what you saw;
  - save a 50 MB-DOM page (the snapshot is skipped and the save still works);
  - press the shortcut twice;
  - sign out mid-upload;
  - lose the network between the upload and `POST /v1/cards`;
  - send another user's `pageSnapshotKey` (ignored);
  - send a non-pending key (ignored);
  - reuse a swept pending key.
- **Worker:**
  - an asset that redirects to a private IP, which `/hop` must refuse;
  - an infinite CSS `@import`;
  - a 4 MiB+1 stylesheet;
  - a `data:` SVG holding a script, which must stay inert under the CSP;
  - `<meta http-equiv=refresh>`;
  - `<base href=javascript:>`;
  - an `<a href=javascript:alert(1)>` link;
  - the budget reached exactly at a boundary;
  - a gzip bomb as the snapshot (the raw cap holds);
  - the fetcher returning busy (retry);
  - Browser Rendering not used anywhere in this step.
- **Workflow:**
  - Refresh details twice quickly: only one archive is kept, and old objects are queued for deletion;
  - a card deleted mid-step: the guard fails, and the object is deleted;
  - archive-only run for a trashed card: skipped.
- **Backfill:**
  - dry-run counts match a `count` query;
  - a page re-run is idempotent;
  - live saves still process within normal latency while it runs.
- **Deletion:**
  - hard delete removes the archive and the pending snapshot;
  - account deletion lists them in `cardStorageObjectKeys`;
  - the "complete stages" test seeds them.

## Tests

- `apps/files-worker/src/archive/inline.test.ts`: table-driven tests over the fixtures above.
  - Asserted outcomes: no `<script>` in the output, every `href` absolute, every `on*` attribute gone, the budget respected, images dropped largest-first, `text_only` past the CSS budget, and charsets decoded.
- `apps/files-worker/src/ops.test.ts`: `archive-page` with a snapshot key, without one, with a foreign key, and with an oversize key.
- `apps/files-worker/src/index.test.ts`: a `page-archive` object is served with the sandbox CSP; other roles are unchanged.
- `apps/files-worker/src/workflows/cardProcessing/run.test.ts`: the step order (the new step is last), `archiveOnly`, the refresh path, and a failure that doesn't fail the card.
- `packages/convex/__tests__/storage/cardObjectKeys.test.ts`: the new keys.
- `packages/convex/accountDeletionWorkflow.test.ts`: seed `pageArchive` and `pendingPageSnapshotKey`.
- `packages/convex/__tests__/card/createCard.test.ts`: `pageSnapshotKey` validation (own pending, foreign, wrong role).
- `packages/convex/__tests__/migration/backfillPageArchives.test.ts`: dry run, paging, skip rules.
- `packages/convex/__tests__/publicApiHttpCards.test.ts`: the upload op (size cap, rate limit) and the serialized `archive` field.
- `apps/extension/__tests__/pageSnapshot.test.ts`: stripping, the 3 s timeout, the over-cap skip, and a save that succeeds when the upload fails.
- e2e: `packages/tests/src/journey/03-api.e2e.ts` uploads a snapshot and creates a card, then waits for `archive.kind === "full"`.

## Proof before the PR

- **Video 1:** save a logged-in page with the extension, then open the card. The Details row goes from "Saving a copy…" to "Archived copy · 1.8 MB". Then open the stored object's signed URL in a tab: it renders, and DevTools shows the CSP blocking scripts.
- **Video 2:** save a 300-image page from the server path and show it falling back to a smaller archive. Then save a huge page and show it ending as "Text only".
- **Screenshots:** the Details row in all three states, in light and dark, at 390 and 1440 px.
- **Numbers:**
  - archive size p50/p95 and step duration p50/p95 over 200 real links on dev;
  - Browser Rendering minutes (expected: 0);
  - R2 GB per 1,000 links;
  - a backfill estimate: production link-card count × p50 size × R2 $/GB-month, plus workflow and fetcher time.

## Release gate

1. Run the narrow tests, then the repo checks and the journey spec.
2. Seed `archive-mix` and `archive-backfill-1000`, run the break-it pass, then fix and add regression tests until it comes back clean.
3. Send the proof bundle, with the cost estimate, to the owner.
4. Merge and deploy the Files Worker, then Convex and web, then publish the extension through its normal release.
5. Run the backfill dry run, show the counts to the owner, and run the pages only after they approve.
6. Smoke-test production: save a link from the web, save a page from the extension, and check both `archive` fields through `teak cards get --json`.

## Risks And Open Questions

- **Server-side JS rendering.** The server path never runs page scripts, so SPAs archived from the web, iOS or the API come out thin. Open decision (default: no live render; extension saves cover SPAs). The alternative is a Browser Rendering `goto` with request interception that allows only public http(s) hosts, capped at 15 s and 200 requests, used only when the static body text is under 500 characters.
- **Cost.** The proof bundle carries measured numbers. As a guide, at a p50 of about 1.5 MB, 1 million links is about 1.5 TB of R2. Open decision (default: go ahead as decided). If the estimate is too high, lower the cap to 10 MB before the backfill.
- **The extension sending HTML** is a privacy change, and the store reviews may ask about it. Open decision (default: always on, no setting, as decided). A Settings toggle "Send the page I see when saving" is the fallback if store review pushes back.
- **Safari.** Its archives are server-only. Open decision (default: Safari stays server-only in v3).
- **The archive is not encrypted end to end.** Same as every other card file.
- **Copyright.** The archive is private, never served to anyone but the owner (no sharing in v3), and deleted with the card.
- **SSRF via subresources.** Every fetch goes through the fetcher's SSRF-pinned `/fetch` or `/hop`, never a bare `fetch` from the Worker. Tests cover redirects to private ranges.
- **Ordering with phase 3.** If phase 3 hasn't shipped, a re-save from the extension of an existing URL returns `duplicate` without sending the snapshot. This phase passes the key on the duplicate path only once phase 3's re-save endpoint exists.
