## Goal

Teak recognises a link you already have, and saving it again moves it to the top instead of making a second card. Phase 2 of the [roadmap v3](2026-10-19-roadmap-v3-00-roadmap.md). It has three parts:

- **One URL key.** Treat two URLs as the same saved link when they differ only by `http`/`https`, `www.`, a trailing slash, a `#fragment` or tracking parameters (`utm_*`, `fbclid`, `gclid`). The duplicate check (extension, Raycast, CLI, API, MCP, Safari) and import duplicate skipping both use one normalized key.
- **Re-saving moves a card to the top.** When you save a link you already have, Teak moves that card to the top of "Newest first" and brings it back from Archive, instead of quietly doing nothing or making a second card. A new `savedAt` time drives the order, and `createdAt` stays the date you first saved it.
- **Paste many links at once.** Paste a list of links into the web composer, one per line, and get one link card per line. Up to 100 links are saved in the background, past the rate limit, and the save stops cleanly at the free plan's cap. Repeats use the re-save rule.

## Progress

- **2a is built** on its own PR: the URL key, `savedAt` with the 13 `…_saved` indexes, both backfills, and the `url-variants` seed pack. The owner chose the real `savedAt` (2026-10-23). Next: deploy the Files Worker, then Convex, then the owner runs `backfillUrlKey` and `backfillSavedAt` on production (dry runs first). 2b waits for both.
- What 2a learned, beyond the plan:
  - `cardSearchDocuments` also copies the card's date to order text search; it gains `cardSavedAt`, read as `cardSavedAt ?? cardCreatedAt`. It has no date index, so it needs no backfill.
  - The Files Worker's import (`src/workflows/import.ts`) shares `normalizeIndexItem`, whose `seen` set now holds URL keys, so its cross-page check hashes each item's key too. That makes 2a a Worker deploy as well, ahead of Convex.
  - `insertCountedCard` sets `urlKey` and `savedAt` for every counted insert, so `createCardForUserHandler`, uploads and imports needn't each set them.
  - The badge cache and duplicate check from phase 1 use the same `GET /v1/cards/duplicate`, so the extension's "Already in Teak" matches variants once 2a's backfill has run.

## Depends on

- Nothing. Phase 5 (CSV import) and phase 6 (page archive) build on the key, and phase 6 also passes its snapshot through the re-save path.

## PRs

Readers can't switch to `savedAt`, and variant matching can't be relied on, until every existing card has the new fields. So this phase ships as two PRs, plus the usual later clean-up:

- **2a: the URL key, the `savedAt` fields and both backfills.** Adds `urlKey` and `savedAt` (fields, indexes, writes on insert, sync), moves the duplicate check and import duplicate skipping to the key with an exact-URL fallback, and adds `backfillUrlKey` and `backfillSavedAt`. The only visible change is that the duplicate check matches URL variants.
- **2b: readers, the re-save rule and pasting links,** after both production backfills finish. Moves every reader to `savedAt`, adds the re-save rule and its UI, and adds pasting a list of links. It deletes the two backfills.
- **Later:** drop the 13 replaced `…_created` indexes, `by_user_url_deleted` and the exact-URL fallbacks, per `.agents/sunset.md`.

## Success Criteria

### URL key (2a)

- A new pure function, `urlKey(url)`, gives every saved link a stable key. `cards.urlKey` holds it, indexed by `by_user_urlkey_deleted` beside `by_user_url_deleted`.
- These all match the existing card `https://www.example.com/post/`:
  - `GET /v1/cards/duplicate?url=http%3A%2F%2Fexample.com%2Fpost%23top` (the `#` is percent-encoded, or the client would drop it before sending)
  - the Convex `findDuplicateCard` query (Safari)
  - `teak cards duplicate`
  - MCP `teak_v1_check_duplicate_url`
- Imports skip a URL whose key matches an existing card (`DUPLICATE_URL`) or an earlier row in the same file (`SOURCE_DUPLICATE`).
- The stored `cards.url` never changes. The card opens the exact address that was saved.
- A paged, dry-run-first backfill sets `urlKey` on every existing card. Until it finishes, the duplicate check also falls back to the exact-`url` index.
- No client update is needed.

### Re-save (2b)

- **Every save path, through one server rule in `createCardForUserHandler`:** the web composer, the share sheets (iPhone, iPad, Mac, Android), email-in, `POST /v1/cards`, bulk create, MCP, CLI and Raycast.
- **What happens on a match.** When a save would create a link card whose `urlKey` matches a live card (not in Trash), Teak creates nothing. It instead:
  - sets the existing card's `savedAt` (and `updatedAt`) to now;
  - un-archives it if it was archived;
  - returns its id.
- **What is not merged.** Tags, notes or text sent with the save are not merged into the card (owner decision). A trashed match is ignored, and a new card is created as today.
- **Order and dates:**
  - "Newest first" and "Oldest first" order by `savedAt`, everywhere a list is ordered by date: the library, archive, favorites, folders, smart folders, tags, sites, search with a date sort, the API, MCP, CLI and the native apps' server-sorted lists.
  - The card details show "Added <first date>" from `createdAt`, plus "Saved again <date>" when `savedAt` is later.
- **What clients are told:**
  - `POST /v1/cards` returns `status: "created"` with `resaved: true` and the card.
  - The web toast says "Already in Teak · Moved to the top", with an Open action.
  - The extension and Raycast show "Already in Teak" and the card moves.
- **Compatibility:**
  - The native apps keep working without an update. The `createCard` mutation still returns an id.
  - `/v1/cards/changes` reports the bump through `updatedAt`.

### Paste links (2b)

- **When the composer splits:** when every non-empty line is a single http(s) URL, it always saves one link card per line (owner decision: always split, no "keep as one note" choice). This needs at least 2 lines; leading `-`, `*`, `+` or `1.` / `1)` list markers are stripped. Anything else (prose, a mix of words and URLs, one URL) is saved as today.
- **The Save button** reads "Save 12 links" while the draft is a link list, and "Save" otherwise. ⌘/Ctrl+Enter does the same.
- **Limits:** at most 100 links per paste. With more lines, the button reads "Save first 100 links" and the toast says how many were left out.
- **The job runs on the server** and keeps going if the tab closes. A toast shows progress ("Saving links · 8 of 12"), then one of:
  - "Saved 12 links";
  - "Saved 9 links · 3 already in Teak, moved to the top";
  - "Saved 4 of 12 links · You've reached 200 cards", with an Upgrade action.
- **Repeats:** repeats inside the paste count once. Links already in Teak follow the re-save rule (bumped and un-archived).
- **Native apps** are unchanged.

## Context And Current Facts

### Duplicates and the URL

- **The duplicate check:** `packages/convex/card/findDuplicateCard.ts:11–29` queries `by_user_url_deleted` with `eq("url", url)` and `isDeleted` undefined, newest first. That is an exact string match. It includes archived cards and excludes trashed ones.
  - Public query `findDuplicateCard` (line 31): used by the Safari extension's `SafariWebExtensionHandler.swift`.
  - Internal query `findDuplicateCardForUser` (line 47).
  - The index is `schema.ts:686` `by_user_url_deleted` `["userId", "url", "isDeleted"]`.
- **Callers of the internal query:**
  - `publicApi/http/duplicate.ts` (`GET /v1/cards/duplicate`, routed at `http.ts:238`);
  - MCP `teak_v1_check_duplicate_url` (`mcp/tools.ts:624`);
  - SDK `cards.duplicate` (`packages/sdk/src/index.ts:976`);
  - CLI `cards duplicate` (`apps/cli/src/index.ts:433`).

  The parity row is `scripts/public-parity.ts:105–107`.
- **No normalization exists:**
  - `assertSafeExternalUrl` (`shared/utils/safeUrl.ts:47–60`) only trims.
  - `createCardForUserHandler` stores `finalUrl` as given (`card/createCard.ts`, the `url: finalUrl` insert).
  - The Chrome extension sends `new URL(content).toString()` (`apps/extension/lib/saveToTeak.ts:113`).
  - `normalizeUrlHost` (`shared/utils/urlHost.ts:1–28`) already lowercases the host and strips `www.` for `site:`. It is the model for the host part.
- **Keeping the key in sync:**
  - `withUrlHost` (`card/searchSync.ts`) recomputes `urlHost` whenever a patch carries `url` or `sourceUrl`.
  - `patchCardWithSearchSync` (line 231) applies it.
  - Search sync also repairs `urlHost` (around line 314).
  - Editing a URL goes through `updateCardField` `"url"` (`card/updateCard.ts:343–349`).
- **Import:**
  - Existing-card skip: `dataImport.ts:554` queries `by_user_url_deleted` and records `DUPLICATE_URL` (line 594).
  - Same-file skip: `importJobItems` `by_jobId_and_url` (lines 439–447, plus `import/indexItems.ts:22`) records `SOURCE_DUPLICATE`.
- **Backfill template:** `migration/backfillUrlHost.ts` (paged, dry run defaults to true, account-deletion gate).
- **Dev seed** queries `by_user_url_deleted` in `devSeed/*.ts` and `devSeed/links.ts`. These keep working, since that index stays.

### Ordering and saving

- **Sort today:**
  - `shared/search/sort.ts` `compareCardsByCreatedAt` (lines 20–29) orders by `createdAt`, then `_creationTime`. It is used in `card/getCards.ts`, `card/listQuery.ts`, `card/visualFilters.ts` and `shared/search/localSearch.ts`.
  - `createdAt` is set once, at insert (`card/createCard.ts`, `createdAt: options.importedVisibleFields?.createdAt ?? now`), or to the imported date.
- **Every date-ordered index is keyed on a copy of `createdAt`:**
  - **`cards`** (`schema.ts:636–686`), read by `card/listQuery.ts:142–235`:
    - `by_created`;
    - `by_user_deleted_created`;
    - `by_user_deleted_archived_created`, also read by `card/cardLinks.ts`;
    - `by_user_deleted_archived_type_created`;
    - `by_user_deleted_archived_favorited_created`;
    - `by_user_deleted_archived_host_created`.
  - **`folderCards.cardCreatedAt`** (`schema.ts:795`), read by `listQuery.ts:260–267`:
    - `by_folderId_and_isDeleted_and_isArchived_and_cardCreatedAt`;
    - `by_folderId_and_isDeleted_and_cardCreatedAt`.
  - **`cardSearchTags.cardCreatedAt`** (`schema.ts:1048`), read by `listQuery.ts:311–356`:
    - `by_user_tag_deleted_created`;
    - `by_user_tag_deleted_archived_created_v2`;
    - `by_user_tag_deleted_archived_type_v2`;
    - `by_user_tag_deleted_archived_favorited_v2`;
    - `by_user_tag_deleted_archived_type_favorited_v2`.
- **Date words** ("last week", "january") become `createdAtRange` (`card/searchCardsPaginated.ts`), bounded on the same indexes (`listQuery.ts:121–123`).
- **What each surface does with a duplicate today:**
  - **Always insert:** `createCardForUserHandler` (`card/createCard.ts:167`), the public `createCard` mutation (line 305, returns `v.id("cards")`), `publicApi/cardsForUser.quickSaveForUser` (`raycast.ts:349`, behind `POST /v1/cards`, result validator `status: v.literal("created")` at line 63), bulk create (`publicApi.ts:862`) and email-in (`inbound/ingest.ts:151`).
  - **Check first, then show "already saved" without writing:**
    - the Chrome and Firefox extension: `apps/extension/lib/saveToTeak.ts:114–125`;
    - Raycast: `apps/raycast/src/lib/capture.ts:165` `showIfAlreadySaved`;
    - Safari: `apps/apple/SafariExtension/Resources/popup.js:72`, through the `findDuplicateCard` query.
  - **Import** skips duplicates (`dataImport.ts:554–600`).
- **Details panel:** `apps/web/src/components/card-modal/cardDetails.ts:63` shows "Added" from `createdAt`.
- **Native apps:** they decode `createdAt`, falling back to `_creationTime` (`apps/apple/.../Models/Card.swift:331`). They pass `createdAtRange` (`LibraryQuery.swift:219`) and don't sort lists themselves.

### The composer

- **Composer:** `apps/web/src/components/forms/AddCardForm.tsx`.
  - `submitTextCard` (around line 225) calls `createCard({...prepareNoteCapture(content), source: "web"})`, behind a "Saving note..." toast.
  - Limit toasts: `isCardLimitError` → `showUpgradeToast`, and `isRateLimitError` → "Too many cards created. Please wait a moment.".
  - The Save button is around line 363, with `SAVE_NOTE_KEYS`. Focus mode saves through `handleFocusSave` (around line 280).
  - Creation status comes from `api.auth.getCardCreationStatus`.
- **Type detection:** `apps/web/src/components/text-editor/noteCapture.ts` `prepareNoteCapture` (line 59).
  - A single self-link paragraph becomes a bare URL.
  - More than one block becomes `type: "text"`.
  - So today a list of URLs on separate lines becomes one text note.
- **Server-side detection:** on the server, `extractUrlFromContent` (`shared/utils/linkDetection.ts:37`) takes only the first URL of untyped content.
- **Pasting:** the editor pastes plain text (`text-editor/README.md`: "Pastes use plain text"), and `linkOnPaste`/`autolink` are off (`markdownDocument.ts`, StarterKit `link` config). Pasted URLs arrive as text in paragraphs. The Markdown serializer may escape characters such as `_` inside them, so detection must read lexer tokens, not raw lines.
- **Limits:**
  - `cardCreation` is a token bucket of 30 per minute with 6 shards (`shared/rateLimits.ts:5–13`), spent per card in `authorizeCardCreation` (`card/quota.ts`). It throws `RATE_LIMITED` with `retryAt` (`quota.ts:44–48`).
  - The free cap is `FREE_TIER_LIMIT = 200` (`shared/constants.ts:280`), enforced in `ensureCardQuotaAvailable` and `insertCountedCard`.
- **Prior art:** import paces itself on `retryAt` (`dataImport.ts`, `createPendingBatch` around line 560). Bulk API create accepts 100 items, but each is refused once the bucket is empty (`publicApi.ts:812–862`, `MAX_BULK_ITEMS = 100` at line 86).

## Constraints And Non-goals

### URL key

- **What `urlKey` does:** parse with `URL`, then:
  - drop the scheme (http and https are equal);
  - lowercase the host, strip trailing dots and a leading `www.`, and drop a port only when it is the default for its scheme (80 for http, 443 for https);
  - remove a single trailing `/` from a non-root path;
  - drop the fragment, except hash routes starting `#/` or `#!`, which are kept;
  - remove query parameters whose lowercased name is `fbclid`, `gclid` or starts with `utm_`;
  - keep every other parameter, in its original order;
  - keep the path's case and percent-encoding as `URL` serializes them;
  - keep any userinfo (`user:pass@`) in the key. `assertSafeExternalUrl` accepts it today, so dropping it would make two different credentialed URLs collide.

  It returns `userinfo + host + path + (query ? "?" + query : "") + kept fragment`. Non-http(s) input returns `undefined`.
- **Schema:** `cards.urlKey: v.optional(v.string())`. Only cards with a `url` get one.
- **No behaviour change on save in 2a.** `createCard`, `POST /v1/cards`, bulk, web, share sheets and email-in still always insert. 2b adds the re-save rule.
- **No merging of existing duplicates.** Two existing cards with the same key both stay, and the duplicate check returns the newest.
- **Index rule:** the new index goes beside the old one. `by_user_url_deleted` is dropped only in a later PR, after `devSeed` moves and the backfill finishes (an entry goes in `.agents/sunset.md`).

### Re-save

- **Fields:**
  - `cards.savedAt: v.optional(v.number())`.
  - The copies: `folderCards.cardSavedAt` and `cardSearchTags.cardSavedAt`.
  - Readers use `savedAt ?? createdAt` until the backfill finishes.
- **New indexes go beside the old ones** (`adding-a-feature.mdx`): 6 on `cards`, 2 on `folderCards` and 5 on `cardSearchTags`. Each has the same fields with `savedAt` in place of `createdAt`. The old ones are dropped in a later PR.
- **Import keeps skipping duplicates.** An import doesn't bump a card, so importing an old export never reshuffles the library.
- **When the rule applies:**
  - Only when the save would produce a `link` card from a bare URL: the `url` field, or content that is only a URL.
  - Content with other text, uploads, text cards and quotes are created as today.
- **Limits:** a re-save spends one `cardCreation` rate-limit token. It doesn't count toward the 200-card cap, so a free user at the cap can still bump.
- **Analytics:** add `card_resaved { surface, wasArchived }` to `shared/analytics.ts` first.

### Paste links

- **Web composer only,** including Focus mode. No API, MCP or CLI operation: they already have `POST /v1/cards/bulk` and stdin bulk.
- **No preview dialog and no checkboxes** (owner decision: always split).
- **One job per user at a time.** A second paste while one runs is refused (no queue), with the toast "Still saving your last links. Try again in a moment." and the draft kept.
- **Each card is created through `createCardForUserHandler`** with `source: "web"`. The re-save rule and the URL key come for free.
- **New table:** `linkPasteJobs`. It is covered by account deletion and removed 7 days after the job finishes (a cron sweep).
- **Analytics:** `link_paste_saved { count, created, resaved, stoppedAtLimit }` in `shared/analytics.ts` first.

## Backend

### 2a: the URL key

- **New `shared/utils/urlKey.ts`:** `urlKey(url: string): string | undefined`, pure. It is exported from `shared/index.ts` so the web and extension can use the same rule.
- **`schema.ts`:** `urlKey` in `cardValidator`, plus `.index("by_user_urlkey_deleted", ["userId", "urlKey", "isDeleted"])` beside line 686.
- **Setting the key on insert:** `card/createCard.ts` sets `urlKey: finalUrl ? urlKey(finalUrl) : undefined` next to `urlHost` (`finalUrl` is `string | undefined`), in `createCardForUserHandler`. That covers the web, the API, Raycast, email-in and import.
- **Keeping it in sync:**
  - Extend `withUrlHost` in `card/searchSync.ts` to also set `urlKey` when `url` is in the patch. Rename it `withUrlFields` and update its two callers.
  - Have the search-sync repair (around line 314) also fix a stale `urlKey`.
- **`card/findDuplicateCard.ts`:**
  1. Compute `key = urlKey(url)`.
  2. If there is a key, query `by_user_urlkey_deleted` (`eq urlKey`, `isDeleted` undefined), newest first.
  3. Also run the exact `by_user_url_deleted` lookup, which finds cards not yet backfilled.
  4. Return the newer of the two live hits.

  Until the backfill finishes, an unbackfilled card is found only by its exact URL, not by a variant. That is acceptable for 2a, because nothing new depends on variant matching yet. PR 2b and phase 5 (import) must not ship before the production backfill has finished.

  The fallback is listed in `.agents/sunset.md`, to be removed after the backfill has run in production.
- **Imports:**
  - `dataImport.ts`: the existing-card check uses the same helper, so it gets the key and the fallback.
  - `importJobItems` gains `urlKey: v.optional(v.string())` and `.index("by_jobId_and_urlKey", ["jobId", "urlKey"])` beside `by_jobId_and_url`. The same-file check (lines 439–447 and `import/indexItems.ts`) uses the key when the item has one.
  - Items written before the deploy have no key. A keyed item also checks `by_jobId_and_url` for its exact URL, so a pre-deploy row in the same job still counts as a duplicate on retry or re-parse; this fallback stays until every pre-deploy job has expired (`.agents/sunset.md`).
- **New `migration/backfillUrlKey.ts`,** copied from `backfillUrlHost.ts`:
  - pages `cards` with a `url` and sets `urlKey` where it's missing or stale;
  - skips accounts being deleted;
  - totals: `examined`, `cardsToUpdate`, `skippedDeletingAccounts`;
  - `dryRun` defaults to true.
- **Account deletion:** no new table. The new field is on existing rows.

### 2a: `savedAt` fields, indexes and backfill

- `schema.ts`:
  - `savedAt` on `cardValidator`;
  - `cardSavedAt` on `folderCards` and `cardSearchTags`;
  - the 13 `…_saved` indexes beside their `…_created` twins.
- **Writes:**
  - Every production card insert sets `savedAt` to the same value as `createdAt`: `insertCountedCard` (`card/cardUsage.ts:414`) fills it when missing, which covers `createCardForUserHandler` and `card/uploadCard.ts:295`; `card/defaultCards.ts:409` (onboarding) and `devSeed/links.ts` insert directly and set it themselves. A test asserts each path writes it, since a card without `savedAt` would drop out of the `…_saved` indexes.
  - Folder-row sync (`syncCardFolderRows`) and tag-row sync (`restartCardSearchTagSync`) copy `savedAt ?? createdAt` into `cardSavedAt`. The tag-sync snapshot kept in `cardSearchTagSyncStates` (`schema.ts:1098`) records it too, and its "has anything changed" comparison includes it, so a bump alone re-syncs the tag rows.
- **New `migration/backfillSavedAt.ts`:**
  - pages `cards` and sets `savedAt = createdAt` where it is missing;
  - pages `folderCards` and `cardSearchTags`, filling `cardSavedAt` from the card;
  - dry run by default, with the account-deletion gate.

### 2b: readers and the re-save rule

- **Readers:**
  - `card/listQuery.ts` switches every `withIndex` to its `…_saved` twin, with bounds on `savedAt`.
  - `compareCardsByCreatedAt` becomes `compareCardsBySavedAt`, using `savedAt ?? createdAt`, in its four callers.
  - Date words bound `savedAt`; the `createdAtRange` argument name stays for client compatibility. Every card-level date predicate and post-filter uses `savedAt ?? createdAt` too, not only the index bounds: `card/getCards.ts`, `card/queryUtils.ts`, `card/visualFilters.ts`, `publicApi/search.ts` and the local cache's `shared/search/localSearch.ts` (both its date filter and its ordering), or a re-saved card would drop out of "last week".
  - Pagination anchors move with the order: `publicApi/cursors.ts` encodes `savedAt ?? createdAt` (as `savedAt`) beside the id, and still decodes an old cursor's `createdAt` as the anchor value, so a cursor issued before the deploy keeps working. The folder and tag page cursors do the same.
  - `card/cardLinks.ts` moves too.
- **The rule (`card/createCard.ts`):**
  - Before inserting, when `type` resolves to `link` and the content is only the URL:
    1. Look up a live card by `urlKey`, using the 2a duplicate helper.
    2. On a hit, `patchCardWithSearchSync(ctx, id, { savedAt: now, updatedAt: now, ...(archived ? { isArchived: undefined, archivedAt: undefined } : {}) })`.
    3. Re-sync folder and tag rows so `cardSavedAt` follows.
    4. Return `{ cardId, outcome: "resaved" }`.

    The lookup runs after `authorizeCardCreation` (which spends the rate-limit token but does not check the cap) and before `insertCountedCard` (which enforces the 200-card cap), so a re-save at the cap succeeds. The web composer still disables single saves at the cap from `getCardCreationStatus`, since it can't know in advance that a link is already saved; the extension, share sheets and API re-save at the cap. (A pasted link list stays submittable at the cap; see Web.)
  - `createCardForUserHandler` returns `{ cardId, outcome: "created" | "resaved" }`.
  - Callers that need only the id (`createCard`, `inbound/ingest.ts`) take `.cardId`. The bulk create case in `executeBulkCardsForUser` (`publicApi.ts:853`) keeps the outcome and returns `resaved: true` for that item, and the bulk result validator and its API mapping gain the optional field.
  - The public `createCard` mutation still returns `v.id("cards")`, for the native apps.
  - A new public mutation, `createCardWithOutcome`, returns `{cardId, outcome}` for the web.
- **Raycast quick save:** `publicApi/cardsForUser.quickSaveForUser` keeps `status: "created"` and adds `resaved: true` on a re-save.
- **Processing:** a bumped card is not reprocessed.
- **Clean-up:** delete `migration/backfillUrlKey.ts` and `migration/backfillSavedAt.ts`, which have run in production by now.

### 2b: paste jobs

- **`schema.ts`:** `linkPasteJobs`:
  - `userId`, `urls: v.array(v.string())` (at most 100);
  - `total` (the URLs kept after normalizing), `omittedOverLimit` (lines past 100), `omittedRepeats` and `omittedUnsafe`, all stored at start so both toasts use the normalized counts, not the raw input;
  - `nextIndex`, `created`, `resaved`, `failed`, and `attempts` for the current URL;
  - `status: "running" | "done" | "stopped_at_limit" | "failed"`;
  - `createdAt`, `updatedAt`, `finishedAt?`;
  - `.index("by_user_status", ["userId", "status"])` and `.index("by_status_finished", ["status", "finishedAt"])`.
- **New `card/pasteLinks.ts`:**
  - **`startLinkPaste({ urls })`** (public mutation):
    1. Normalize: trim, `sanitizeExternalUrl`, drop unsafe entries (counted as `failed`), and collapse repeats by `urlKey`.
    2. Cap at 100.
    3. Refuse when a running job exists: `ConvexError { code: "PASTE_ACTIVE" }`.
    4. Insert the job, then run the first batch inline.
    5. Return `{ jobId }`.
  - **`processLinkPaste({ jobId })`** (internal mutation), creating up to 10 cards per run:
    - on success, it bumps `created` or `resaved` from the re-save rule's outcome;
    - `RATE_LIMITED` means it schedules itself at `retryAt` and stops this run;
    - `CARD_LIMIT_REACHED` ends the job with status `stopped_at_limit`. A re-save never hits it (the rule checks for a match before the cap), so links already in Teak before that point are still bumped;
    - a permanent input error for that URL (`INVALID_INPUT`, unsafe URL, `CONTENT_TOO_LARGE`) counts as `failed` and moves on;
    - any other error keeps the URL, bumps `attempts`, and schedules the job again with backoff (5 s, 30 s, 2 min); after the third attempt that URL counts as `failed` and the job moves on;
    - when a run ends with URLs left and no other reschedule, it schedules `processLinkPaste` again at once (`ctx.scheduler.runAfter(0, …)`);
    - the status becomes `done` only after the run that handles the last URL.
  - **`getLinkPaste({ jobId })`** (public query): the counts and status, owner-checked.
- **`crons.ts`:** a daily sweep deletes `linkPasteJobs` whose `finishedAt` is older than 7 days.
- **Account deletion:** `accountDeletionData.ts` `ancillaryPage` deletes the user's `linkPasteJobs`. Its batch's `length > 0` joins `ancillaryPage`'s continuation return (`accountDeletionData.ts`, the `return (cardLinks.length > 0 || …)` near line 202), so more than one page of rows is deleted; the test seeds more than 100 rows. Add it to the "complete stages" test.

## Web

- **2a:** no UI. The web never calls the duplicate check today.

### 2b: re-save

- **`apps/web/src/components/forms/AddCardForm.tsx`:**
  - `submitTextCard` calls `createCardWithOutcome`.
  - On `resaved`, the toast reads "Already in Teak · Moved to the top", with an "Open" action that opens the card modal. If the card was archived, it reads "Already in Teak · Moved back from Archive".
  - The optimistic card (lines 202–217) is removed when the outcome is `resaved`, so no ghost tile is left. The real card's `savedAt` change moves the tile through the reactive query.
- **`card-modal/cardDetails.ts`:**
  - "Added" stays `createdAt`.
  - A new "Saved again" row shows `formatCardDate(savedAt)` when `savedAt - createdAt > 60_000`.
- **Smart folders and the search box:** no change. Order follows `savedAt`.

### 2b: paste links

- **`noteCapture.ts`:** `extractLinkList(markdown): string[] | null`.
  - Lex with `marked`. Accept only paragraphs and list items whose inline content is a single URL: plain text, a self-link, or an autolink. Each soft or hard line break inside a paragraph splits it.
  - Strip list markers; skip empty lines.
  - Return the URLs in order when there are 2 or more and every line qualifies; otherwise return `null`.
- **`AddCardForm.tsx`:**
  - Derive `linkList = extractLinkList(content)` on change, memoized.
  - **Button label:** "Save" stays the same when `linkList` is null. Otherwise it reads `Save ${n} links`, or "Save first 100 links" past 100. The width animates over 150 ms.
  - **On submit with a list:**
    1. Reset the draft and call `startLinkPaste`.
    2. Show a loading toast, "Saving links · 0 of n" (n is the job's stored `total`), fed by `useQuery(api.card.pasteLinks.getLinkPaste, { jobId })`.
    3. Swap it for the final toast (copy in Success Criteria).
  - **The final toast:**
    - with resaves, it adds "· 3 already in Teak, moved to the top";
    - with failures, "· 2 couldn't be saved".
  - **Errors:**
    - `PASTE_ACTIVE` restores the draft and shows "Still saving your last links. Try again in a moment.".
    - At 200/200 the composer's `canCreateCard` gate (`AddCardForm.tsx:227`) would block the submit, but some links may only be re-saves. So a link list stays submittable at the cap: the job starts, re-saves bump, and the first new link stops the job (`stopped_at_limit`), which shows the existing upgrade toast with the counts so far.
  - No optimistic tiles: cards appear as the job creates them, through the reactive grid.
- **Focus mode** (`FocusEditor`) shares `submitTextCard`, so it gets the same label and behaviour.

## Extension, Raycast and Safari (2b)

- **Extension** (`apps/extension/lib/saveToTeak.ts`):
  - Drop the duplicate pre-check before `POST /v1/cards` for URL saves. The POST now bumps.
  - Map `resaved: true` to the existing `duplicate` outcome, so the popup shows "Already in Teak", now with the card moved.
  - The phase 1 badge still uses `GET /v1/cards/duplicate`.
- **Raycast:** `capture.ts` `showIfAlreadySaved` is replaced by the save's result. A `resaved: true` result shows the "Already saved" toast with "Moved to the top" as its message.
- **Safari:** `popup.js` drops its `findDuplicateCard` pre-check and calls `createCard`. A `resaved` result can't be seen through `createCard`'s id-only return, so it shows "Saved". This ships with the next Apple app build.

## API / MCP / SDK / CLI

### 2a

- **No new operation.** The behaviour change applies to `GET /v1/cards/duplicate`.
- **`publicApi/openApi/`:** the operation's description says it matches the same link ignoring `http`/`https`, `www.`, a trailing slash, a `#fragment` and `utm_*`/`fbclid`/`gclid` parameters.
- **MCP:** the same sentence goes in `teak_v1_check_duplicate_url`'s description (`mcp/tools.ts:624`).
- **CLI:** the `cards duplicate` help text gets the same sentence.
- `scripts/public-parity.ts`: no change.

### 2b

- **`POST /v1/cards`:**
  - `status` stays `"created"`: the OpenAPI schema is `enum: ["created"]` (`publicApi/openApi/`) and the SDK's `asCreate` (`packages/sdk/src/index.ts:724`) throws `PARSE_ERROR` on any other value, so a new status would break every shipped SDK and CLI. A re-save adds `resaved: true` (and `wasArchived: true` when it un-archived the card) beside it. Old clients ignore the extra fields.
  - The response code stays 200, and idempotency replay returns the original response.
- **Tags and notes on a re-save** are ignored (owner decision). The API, MCP and CLI docs say so, and `resaved: true` in the response tells a caller to `PATCH` the card if it wants them applied.
- **Card schema:** `savedAt: number` in `serializeCard` and `serializeListCard` (`publicApi/http/serializers.ts`). `createdAt` keeps its meaning.
- **`GET /v1/cards`:** `sort=newest|oldest` follows `savedAt`. The OpenAPI description says so.
- **Bulk create:** a resaved item keeps `status: "created"` and adds `resaved: true`, with its `cardId`.
- **MCP:** `teak_v1_create_card` (or the current save tool name) returns the status, and its description explains re-save.
- **SDK:** `CreateCardResponse` gains optional `resaved` and `wasArchived`, and `Card.savedAt` is added. `asCreate` keeps requiring `status: "created"`.
- **CLI:** `teak save` prints "Already in Teak, moved to the top: <id>" when `resaved` is true. `cards get` prints "Saved again <date>".
- **Export:** `savedAt` goes in `cards.json` as a `DualTimestamp`. `SCHEMA_VERSION` stays 2; it is an additive field. The Teak archive importer reads it back through `importedVisibleFields` for the cards it creates (falling back to `createdAt` for older exports), so a round trip keeps the order; existing duplicates are still skipped, not bumped.
- **Pasting links** adds no public operation. `scripts/public-parity.ts` is unchanged: the new paste functions are session-only Convex functions, not public API.

## Docs

- **2a:**
  - `(developers)/api.mdx`, `mcp.mdx` and `(apps)/cli.mdx`: the matching rule.
  - `(data)/import.mdx`: "Links you already have, or that appear twice in the file, are skipped, even when one has `www.`, a trailing slash or tracking parameters."
  - The month's changelog: "Teak recognises a link you've already saved, even with tracking parameters".
- **2b:**
  - `features.mdx`: a "Saving something again" note, and the Date token row now reads "Date saved (or saved again)".
  - `features.mdx`, under saving: "Paste a list of links, one per line, and Teak saves each as its own card (up to 100 at a time)."
  - `(developers)/api.mdx`: `resaved` and `savedAt`. Also `mcp.mdx` and `(apps)/cli.mdx`.
  - `(apps)/extension.mdx` and `raycast.mdx`: what "Already in Teak" now does.
  - The month's changelog: "Saving a link again moves it to the top" and "Paste a list of links to save them all".

## UI states

- **2a:** none of its own. The extension's existing "Already in Teak" state now appears for URL variants too.
- **Re-save of a visible card:** the tile animates to the top (150–200 ms), with no flash of a duplicate tile.
- **Re-save of an archived card while viewing Archive:** the tile leaves Archive, and the toast says "Moved back from Archive".
- **Re-save while viewing a folder** the card isn't in: no visual change, and the toast's Open action still works.
- **Rate-limited single save:** the existing "Too many cards created…" toast.
- **Error on a single save:** the existing failure toast. The draft is restored.
- **Composer, empty draft:** no button, as today.
- **Composer, one URL:** "Save", and one link card, as today.
- **Composer, 2–100 URLs:** "Save 12 links".
- **Composer, 101+ URLs:** "Save first 100 links", and the final toast adds "· 37 left out (100 at a time)".
- **Composer, mixed lines,** such as a URL with a word after it: "Save", and one note.
- **Long paste job** (100 links at 30 a minute takes about 3–4 minutes): the progress toast stays. If the page reloads, the toast is gone, but the cards keep arriving.
- **Card limit mid-job:** the final toast with Upgrade.
- **Rate-limited paste:** handled inside the job; the person never sees it.
- **Failed paste job:** "Couldn't save the links. Try again.", and the draft is not restored, since some cards may exist.

## Scenario seed packs

- **`url-variants`** (2a):
  - 40 link cards covering each rule and its near misses:
    - `http` and `https`;
    - `www` and bare;
    - a trailing slash and none;
    - `#section`, `#/route` and `#!/route`;
    - `utm_source` and `utm_medium` together, `fbclid` and `gclid`;
    - `?id=1&utm_source=x` versus `?id=1`;
    - `?id=1` versus `?id=2` (must stay different);
    - `?b=2&a=1` versus `?a=1&b=2` (stay different, by design);
    - uppercase hosts and paths (only the host is case-folded);
    - ports `:443` and `:8080`;
    - IDN hosts, percent-encoded paths, a 2,000-character URL.
  - Half the cards are seeded without `urlKey` or `savedAt`, to exercise the fallbacks and the backfills.
- **`resave`** (2b):
  - 300 link cards spread over 3 years, with a known `urlKey` set;
  - 20 archived matches and 5 trashed matches;
  - one card in 3 folders and tagged `reading`;
  - a card whose URL variant differs only by `utm_source`;
  - a free account at 200/200 cards.
- **`ordering-saved`** (2b): cards whose `savedAt` and `createdAt` disagree, for testing ordering, date words and folder and tag lists.
- **`paste-links`** (2b): a free account with 195 cards, plus 10 link cards whose URLs (some archived) appear in the fixture paste lists.
- **Fixture paste texts** (in the e2e spec, not seeded):
  - 2 links;
  - 12 links in a bulleted list;
  - 100 and 140 links;
  - links with `_` and `)` characters;
  - IDN links;
  - links with blank lines between them;
  - a list where one line has trailing words;
  - the same link three times;
  - a `javascript:` line.

## Break-it checklist

### 2a

- **Duplicate check:**
  - Each variant through `GET /v1/cards/duplicate`, `teak cards duplicate`, MCP and the Safari `findDuplicateCard` query.
  - A trashed card's key must not match.
  - Two live cards with one key return the newest.
- **Editing:** change a card's URL in the web app (`updateCardField url`), and the duplicate check follows the new URL.
- **Import:** a CSV listing the same link three ways gives one card and two `SOURCE_DUPLICATE` rows. A row matching an existing card gives `DUPLICATE_URL`.
- **Backfills:**
  - The dry runs report counts without writes.
  - Run each twice; the second run updates 0.
  - An account mid-deletion is skipped.
- **Inserts:** every insert path writes `savedAt`, so no new card drops out of a `…_saved` index.
- **Bad input:** `javascript:`, `data:`, an empty string and a malformed URL each return `undefined` and never throw.

### 2b: re-save

- **Concurrency:**
  - Re-save the same URL from two tabs at once: one bump, and no second card (OCC on the existing card).
  - Re-save inside a bulk request that also contains the same URL twice.
- **Matches:**
  - A trashed match makes a new card.
  - An archived match comes back.
  - A free user at the cap can still bump.
- **Content:** a URL with a note through `POST /v1/cards` (the note is ignored, as decided; see Risks), and text with a URL plus words (makes a new card).
- **Order and dates:**
  - Folder, tag, site and favorites views show the bumped card first.
  - `Oldest first` puts it last.
  - `last week` finds a card first saved last year but saved again yesterday.
- **Compatibility:**
  - Native apps (old builds) list in the new order, and their share sheets bump.
  - Idempotency-Key replay of a resave.
  - `/v1/cards/changes` shows the bumped card.
  - An API cursor issued before the deploy still pages.

### 2b: paste links

- Double-press ⌘Enter: one job.
- Paste 100, close the tab, and reopen after 4 minutes: all 100 are saved.
- Paste while a job runs: the `PASTE_ACTIVE` toast, and the draft is kept.
- 195/200 cards, then paste 12: 5 saved, then the cap toast. The repeated links bump and don't count toward the cap.
- Two tabs paste different lists at once: one is refused.
- Offline submit: the mutation fails, and the draft comes back.
- A list in a code block, or a quote of URLs: not split (only paragraphs and list items).
- Keyboard only; 390px composer label width with "Save first 100 links".

## Tests

### 2a

- `packages/convex/__tests__/shared/utils/urlKey.test.ts`: `test.each` over every rule and near miss in the seed pack, plus fuzz input (random strings never throw).
- `packages/convex/__tests__/card/findDuplicateCard.test.ts`:
  - variants match;
  - trashed cards are excluded;
  - the newest live card wins;
  - the fallback finds a card without `urlKey`.
- `packages/convex/__tests__/card/updateCard.test.ts`: editing the URL updates `urlKey`.
- `packages/convex/__tests__/import/*`: duplicates by key within the file and against the library.
- `packages/convex/__tests__/migration/backfillUrlKey.test.ts` and `backfillSavedAt.test.ts`: dry run, apply, idempotence, deletion gate.
- `packages/convex/__tests__/card/createCard.test.ts` (and the upload, onboarding and dev-seed paths): each insert writes `savedAt` equal to `createdAt`; folder and tag rows copy it.
- `packages/convex/__tests__/publicApi/http/cards.test.ts` and `__tests__/mcp/tools.test.ts`: the variant matches through HTTP and MCP.

### 2b

- `packages/convex/__tests__/card/createCard.test.ts`:
  - bump, un-archive, trashed ignored;
  - a note or extra text creates a new card;
  - the cap is not counted, and the rate limit is spent.
- `packages/convex/cardListOrdering.test.ts` (Vitest, already listed): every list path orders by `savedAt`, and the fallback to `createdAt` for a card without it.
- `packages/convex/__tests__/shared/search/sort.test.ts` and `localSearch.test.ts`.
- `packages/convex/__tests__/publicApi/http/cards.test.ts`, `__tests__/mcp/tools.test.ts`, `__tests__/sdk.test.ts`, `__tests__/export/serialize.test.ts`.
- `packages/convex/__tests__/card/pasteLinks.test.ts`:
  - dedupe by key;
  - the cap at 100;
  - a `RATE_LIMITED` reschedule (the limiter mocked at its boundary);
  - stopping at the card limit;
  - resaved counting;
  - `PASTE_ACTIVE`;
  - owner checks on `getLinkPaste`.
- `packages/convex/accountDeletionWorkflow.test.ts`: seed a `linkPasteJobs` row.
- `apps/extension/__tests__/lib/saveToTeak.test.ts`: `resaved` maps to duplicate, and no pre-check request is made.
- `apps/raycast/src/__tests__/capture.test.ts`.
- `apps/web/src/components/text-editor/__tests__/noteCapture.test.ts`: `extractLinkList` over every fixture text, including the negatives.
- `apps/web` `AddCardForm` tests: the resaved toast with no optimistic tile left, and the button label for 0, 1, 2 and 101 links.
- e2e:
  - `packages/tests/src/web/resave.e2e.ts` (new);
  - `packages/tests/src/web/paste-links.e2e.ts` (new): paste 12 and wait for 12 tiles; paste 3 with 1 existing and see the resave toast;
  - `journey/03-api.e2e.ts` for `resaved: true` (and an old-SDK parse of that response).

## Proof before the PR

### 2a

- **Captured requests:** `GET /v1/cards/duplicate` for five variants of one link, each returning the same `cardId`, plus `?id=2` returning `null`.
- **CLI:** `teak cards duplicate` output for the same.
- **Import:** a video of a CSV with variant duplicates, and the import report listing the skipped rows.
- **Backfills:** the dry-run output, then the totals of a real run, on dev, plus Convex index-rebuild timings.

### 2b

- **Video 1:** scroll to a card from last year, paste its URL in the composer, and watch it jump to the top with the toast.
- **Video 2:** an archived card saved again from the extension leaves Archive.
- **Video 3:** paste 12 links and watch the label become "Save 12 links", the progress toast, and the tiles arriving.
- **Video 4:** 195/200 cards, paste 12, and the cap toast with Upgrade.
- **Screenshots:** the details panel with "Added" and "Saved again", the re-save toast, the button label states and the final paste toasts, in light and dark at 390px and 1440px.
- **Captured requests:** `POST /v1/cards` returning `resaved`, the bulk mixed result, and `teak save` output.

## Release gate

1. **PR 2a:** run the narrow tests, then the repo checks. Seed `url-variants`, run the 2a break-it pass, and fix and add regression tests until it is clean. Send the 2a proof bundle to the owner. Merge, and deploy Convex. The owner runs `backfillUrlKey` and `backfillSavedAt` on production: the dry runs first, then pages, watching database I/O (`.agents/convex-costs.md`). Smoke-test `teak cards duplicate` with a `utm_` variant of a production card.
2. **PR 2b,** once both production backfills have finished: run the narrow tests, the repo checks and the e2e specs. Seed `resave`, `ordering-saved` and `paste-links`, run the 2b break-it pass, and send the 2b proof bundle. Merge, deploy Convex, then web. Smoke-test a re-save and pasting 3 links on production.
3. **Later PR:** drop the 13 `…_created` indexes the readers no longer use. `by_created` stays, since admin, export and backfills use it. Remove the exact-URL duplicate fallback and `by_user_url_deleted` once `devSeed` has moved, and the import-item fallback once every pre-deploy job has expired. Record each removal in `.agents/sunset.md`.

## Risks And Open Questions

- **Open decision (default: only `utm_*`, `fbclid` and `gclid` are stripped).** The owner named these. `ref`, `igshid`, `mc_cid`, `si` (Spotify/YouTube share ids) and others are left alone, because some sites use `ref` meaningfully.
- **Open decision (default: `#/` and `#!` fragments are kept).** Single-page apps use them as routes. Every other fragment is dropped.
- **Open decision (default: query parameter order is kept).** Sorting would merge `?a=1&b=2` and `?b=2&a=1`, but it changes the key of every URL with two or more parameters. That is harmless, since it is new, but unnecessary.
- **A key that's too loose** could hide a genuinely different page, for example `example.com/page` versus `example.com/page/` on servers that treat them differently. The duplicate check only answers "already saved"; it never merges or deletes, so the cost is a missed save. The re-save rule bumps the existing card instead of creating a new one, which makes this more visible.
- **Cost.** 13 new indexes and a backfill touching every card, folder row and tag row. A cheaper alternative needs no new index and no backfill: on re-save, write the old `createdAt` into a new `firstSavedAt` and set `createdAt` to now. Its catch is that `createdAt` in the API changes meaning. **Open decision (default: the owner's `savedAt` design as written; the alternative is offered for review).**
- **Open decision (default: tags, notes and extra text sent with a re-save are dropped).** The owner chose no merging. The extension and Raycast add tags and notes after the save with `PATCH`, so nothing is lost there. An API caller sending `notes` with a known URL loses them silently, and the `resaved` status is its only signal.
- **Open decision (default: imports never bump).** The owner said "everywhere", but importing an old export would otherwise reorder the whole library.
- **Open decision (default: date words filter by `savedAt`).** Keeping them on `createdAt` would need the old indexes forever.
- **Safari** can't tell "resaved" from "created" until a later Apple change adds an outcome to the share path.
- **Open decision (default: 100 links per paste, 10 cards per mutation run).** 100 links at 30 a minute takes over 3 minutes, so the progress toast matters.
- **Open decision (default: one running paste job plus none queued).** The simplest rule. A second paste is refused, not queued.
- **Open decision (default: list items count, code blocks and quotes don't).** Pasting a bulleted list of links is common. A quoted list is more likely meant as a note.
- **Escaping.** Tiptap's Markdown serializer may escape characters in URLs, so link-list detection works on lexer tokens and decodes entities (`decodeHtmlEntities`). Tests cover `_`, `*`, `(` and `)`.
