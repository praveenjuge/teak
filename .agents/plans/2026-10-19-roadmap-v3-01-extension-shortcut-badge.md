## Goal

Save the current page from the Chrome and Firefox extension with a keyboard shortcut and no popup, and show on the toolbar icon when the page in the active tab is already in Teak. Phase 1 of the [roadmap v3](2026-10-19-roadmap-v3-00-roadmap.md).

## Depends on

- Nothing. Phase 2 (normalized URL key) makes the badge match `www`/`utm_*` variants. Until it ships, the badge matches the exact URL the extension sends, which is today's duplicate check.

## Success Criteria

- **The shortcut:**
  - Alt+Shift+S (⌥⇧S on Mac) saves the active tab's page in the background. The popup does not open.
  - The default can be changed in the browser's own shortcut settings: `chrome://extensions/shortcuts`, or Firefox's Manage Extension Shortcuts.
- **Feedback, all on the toolbar icon:**
  - While saving, the badge shows "…".
  - On success it shows "✓", and the tooltip becomes "Saved to Teak".
  - On failure, "!" shows for 4 seconds with a tooltip naming the problem. The icon then returns to its normal state.
- **The badge:** while a tab shows a page that's already in Teak, the icon carries a "✓" badge and the tooltip "Already in Teak". Otherwise there is no badge, and the tooltip is "Save to Teak" (the current `default_title`).
- **When the badge check runs:**
  - When a tab is activated, when it finishes loading, and when the window gains focus.
  - Never for restricted URLs (`isRestrictedUrl`) or incognito/private tabs, or while signed out.
- **Cache:** results are cached per URL for 5 minutes. A save from the popup, a context menu, an inline post button or the shortcut sets the cache to "saved" at once.
- **Privacy:** the policy and the store listings say the extension checks the open page's address with Teak to show the badge.
- **Native apps:** unchanged. The Safari extension (`apps/apple/SafariExtension`) is not part of this phase.

## Context And Current Facts

- **Manifest** (`apps/extension/wxt.config.ts`):
  - `permissions` at lines 53–60: identity, storage, activeTab, tabs, contextMenus, scripting. `host_permissions: ["<all_urls>"]` at line 61, `omnibox` at 62, `action.default_title: "Save to Teak"` at 63–64.
  - There is no `commands` key.
  - Firefox `data_collection_permissions.required` already lists `browsingActivity` (line 46).
- **Background** (`apps/extension/entrypoints/background.ts`):
  - `defineBackground` (line 370) wires `contextMenus.onClicked`, `runtime.onMessage`, `runtime.onConnect` and the omnibox.
  - No code calls `chrome.commands`, `chrome.action.setBadgeText` or `setTitle`, or listens to `tabs.onActivated`, `tabs.onUpdated` or `windows.onFocusChanged`.
- **Save sources:**
  - Saves run through the pending-save store: `runPendingSave` (line 83), `queueSave` (line 195), `lib/pendingSaves.ts`.
  - The `SAVE_CONTENT` message validator (line 351) accepts `source` only as `popup-auto-save` or `context-menu`.
  - Context-menu saves pass `source: "context-menu"` (line 536). Inline posts use `"inline-post"` (line 801), popup files `"popup-file"` (line 662).
- **Duplicate check:**
  - `lib/saveToTeak.ts` `saveToTeak` (line 88) calls `GET /v1/cards/duplicate?url=` (lines 114–125) before `POST /v1/cards`. On a match it returns `{status: "duplicate", cardId}`.
  - `packages/convex/publicApi/http/duplicate.ts` handles the request: auth through `withAuthorizedUser`, then `findDuplicateCardForUser`. It returns `{cardId|null}`.
- **Request budget:**
  - Every authorized API call spends the per-user `publicApiRequests` token bucket: 120 per minute (`shared/rateLimits.ts:29–35`, used by `publicApi.ts:1075`).
  - The Files Worker edge also has `API_REQUEST_LIMITER` at 120 per 60 seconds (`apps/files-worker/wrangler.jsonc`, `ratelimits`).
- **Auth:** OAuth via `lib/oauthAuth.ts` (`oauthRequest`, `getOAuthState`). `useExtensionSession` drives the popup's signed-in state.
- **Popup:** `entrypoints/popup/App.tsx` auto-saves the page when it opens (`hooks/useAutoSaveUrl.ts`). It already has a duplicate state (`alreadySaved`, line 492).
- **Restricted pages:** `lib/restrictedUrl.ts` `isRestrictedUrl` (line 51) and `restrictedUrlMessage` (line 64).
- **Privacy policy:** `apps/docs/content/docs/(legal)/privacy-policy.mdx:137` says the extension "doesn't track your browsing" and "sends nothing until you click save". The badge changes that.
- **Safari:** a separate native extension (`apps/apple/SafariExtension/Resources/manifest.json`: activeTab, nativeMessaging, storage; `background.js` is a stub). It shares no code with the WXT build.

## Constraints And Non-goals

- Chrome and Firefox (the WXT build) only. No Safari shortcut or badge.
- **No new backend endpoint.** The badge uses `GET /v1/cards/duplicate`, kept inside the request budget:
  - per-URL cache of 5 minutes in `chrome.storage.session`;
  - a 400 ms debounce per tab;
  - one request in flight per URL;
  - a soft cap of 30 badge checks a minute (extra checks are skipped, and the badge stays unknown);
  - saves come first: the API allows 120 requests a minute per user, so badge checks stop for the minute once the extension's own sliding count of all its requests (badge checks, saves, popup reads) reaches 80, leaving 40 for saves and the popup.
- **Error handling:** a 429 pauses badge checks for the `Retry-After` time. A failed check clears the badge; it never shows "!" (that is for saves only).
- **Shortcut saves:** they use the same `saveToTeak` path and pending-save store as the popup, with a new source value, `shortcut`. The pending-save store gives each save a fresh id (its Idempotency-Key), so it does not coalesce two presses on its own: the background keeps an in-memory `Map<url, Promise>` of shortcut saves in flight, and a second press for the same URL awaits the first one's result instead of queueing another save.
- **Popup:** the shortcut never opens it, except when the user has to act: signed out, or at the card limit. Then it calls `chrome.action.openPopup()`, which the popup handles as today. Today `runPendingSave(save, true)` starts OAuth itself on `unauthenticated` (`background.ts:163`), so the shortcut runs its save with `interactive: false` (`queueSave` gains that option) and opens the popup on `unauthenticated`.
- **Analytics:** the extension's "card saved" event gets `via: "shortcut"`. Today it sends `via: save.kind` (`background.ts:178`), which is "content" for every content save, so it changes to `via: save.kind === "content" && save.input.source === "shortcut" ? "shortcut" : save.kind`. Badge checks send nothing.

## Extension

- **`wxt.config.ts`:**
  - Add the `commands` key:

    ```ts
    commands: { "save-page": { suggested_key: { default: "Alt+Shift+S", mac: "Alt+Shift+S" }, description: "Save this page to Teak" } }
    ```
  - Firefox accepts the same key. No permission changes are needed (`tabs` is already granted).
- **`entrypoints/background.ts`:**
  - `chrome.commands.onCommand.addListener((command, tab) => …)` for `save-page`:
    1. Read the active tab.
    2. Reject a tab with no `url`, restricted URLs (`isRestrictedUrl`) and any other non-http(s) scheme such as `blob:` (the same http(s) guard the badge check uses) with "!" and the tooltip from `restrictedUrlMessage`.
    3. Otherwise set the badge to "…" and `queueSave({ kind: "content", input: { content: url, source: "shortcut" } }, { interactive: false })`, with `url` narrowed to a string, through the per-URL in-flight map above.
  - Add `"shortcut"` to `SaveSource` (`lib/saveToTeak.ts:9`) and `SaveContentSource` (`types/messages.ts:17`), and widen the `SAVE_CONTENT` validator at line 351 to accept it.
  - Map each pending-save outcome to the badge (new `lib/toolbarBadge.ts`):

    | Outcome | Badge | Tooltip | Then |
    |---|---|---|---|
    | saved | "✓" | "Saved to Teak" | Cache the URL as saved. |
    | duplicate | "✓" | "Already in Teak" | Cache the URL as saved. |
    | unauthenticated | — | — | `openPopup()`. |
    | `CARD_LIMIT_REACHED` | — | — | `openPopup()`, which shows the upgrade prompt. |
    | rate limited | "!" | "Too many saves. Try again in a minute." | — |
    | network or other error | "!" | "Couldn't save. Try again." | The pending save stays retryable from the popup, as today. |

    "!" lasts 4 seconds, then the badge returns to the page's known state.
- **New `lib/toolbarBadge.ts`:**
  - `setTabBadge(tabId, state, title?)`, where state is `"saved" | "saving" | "error" | "none"`, with text and colour per state and a default title per state. `title` overrides the tooltip, so the error rows above (rate limited, other errors, restricted pages) each show their own message:
    - "✓" on the brand green, which must pass contrast on light and dark toolbars;
    - "…" on neutral grey;
    - "!" on the destructive red.
  - Badge text and colour are always set per tab (`tabId`), never globally, so other tabs never show a wrong badge.
- **New `lib/savedPageCheck.ts`:**
  - `checkSavedPage(tab)`:
    1. Skip incognito tabs, restricted URLs, non-http(s) pages and signed-out state.
    2. Read the cache (`chrome.storage.session`, key `saved:<url>` → `{saved, at}`).
    3. On a miss, call `GET /v1/cards/duplicate` through `oauthRequest`.
    4. Before setting the badge, check that the tab still shows the URL that was checked (a per-tab request generation number); a result for a URL the tab has navigated away from is cached but never painted.
  - Debounces per tab and keeps a sliding one-minute counter for the soft cap.
  - Wired to `tabs.onActivated`, `tabs.onUpdated` (when `status === "complete"` or the URL changes) and `windows.onFocusChanged`.
  - Sign-out clears the cache and every badge.
- **Cache warming:** every successful save path updates the cache through one function, `markSaved(url, cardId)`: popup auto-save, context menu Save Page, inline post buttons and the shortcut. Deleting a card in Teak isn't visible to the extension; the 5-minute cache bounds how stale it gets.
- **Popup:** when it opens on a page whose cache says saved, it still auto-saves exactly as today. No behaviour change.

## Backend

- No change.
- The privacy policy change ships in this PR.

## API / MCP / SDK / CLI

- No change.

## Docs

- **`apps/docs/content/docs/(apps)/extension.mdx`:**
  - A "Save with a shortcut" section: ⌥⇧S / Alt+Shift+S, how to change it in each browser, and what each badge means.
  - An "Already in Teak" badge section.
- **`apps/docs/content/docs/(legal)/privacy-policy.mdx:137`:** replace "It doesn't track your browsing" with: while you're signed in, the extension asks Teak whether the page in your current tab is already saved, sending that page's address. Teak doesn't store these checks. Private and incognito windows are never checked.
- **The month's changelog:** "Save a page with ⌥⇧S, and see when it's already in Teak".
- **`apps/extension/release.md`:**
  - Chrome Web Store: the privacy practices form gains "Web history" or "Website content" as needed.
  - AMO: `browsingActivity` is already declared.

## UI states

- **Signed out:** no badge; the shortcut opens the popup's sign-in.
- **Saving:** "…" until the request ends. A save that takes longer than 10 seconds leaves "…" until the pending-save store resolves or fails.
- **Saved / already in Teak:** "✓".
- **Error:** "!" for 4 seconds with a specific tooltip.
- **Restricted page** (`chrome://`, the Web Store, `about:`): the shortcut shows "!" with "Teak can't save this page."
- **Rate-limited:** the badge doesn't change on a skipped check; a shortcut save shows "!" with "Too many saves…".
- **Many tabs:** switching quickly through 50 tabs costs at most 30 requests a minute; the others show no badge until the next activation after the cap resets.

## Scenario seed packs

- **`extension-badge`:**
  - 20 link cards whose URLs match a local fixture page list: plain, `www`, a trailing slash, `utm_source`, a fragment, a 2,000-character URL, IDN and RTL paths;
  - one archived card and one trashed card with fixture URLs.

  Trashed cards must show no badge, since `findDuplicateCard` excludes `isDeleted`. Archived cards show "✓".

## Break-it checklist

- **Shortcut:**
  - Press it twice quickly on the same page: one card. The per-URL in-flight map makes the second press wait for the first and show its result; a test fires both presses before the first request resolves.
  - Navigate a tab while its badge check is in flight: the old result never paints the new page.
  - Press it on `chrome://extensions`, a PDF tab, `view-source:`, and a `file://` page.
  - Press it while signed out.
  - Press it at 199/200 cards, then at 200/200.
  - Press it offline, then reconnect: the pending save resumes (`resumePendingSaves`) and the badge updates.
- **Badge:**
  - Switch through 60 tabs in 20 seconds: no 429 from the API, and the badge stays correct.
  - Open the same URL in two windows.
  - Sign out while badges are showing.
  - Delete a card in the web app, then return to the tab within and after 5 minutes.
  - Incognito window with the extension allowed: no checks, confirmed in the network log.
  - Firefox: the `commands` key works, and the shortcut isn't taken by Firefox (⌥⇧S on Mac).
- **Collisions:** change the shortcut to a key a site uses, and confirm the browser's own conflict rules decide.

## Tests

- `apps/extension/__tests__/lib/toolbarBadge.test.ts`: outcome → text, colour and title, and per-tab calls only. Mock the `chrome.action` boundary.
- `apps/extension/__tests__/lib/savedPageCheck.test.ts`:
  - skips restricted, incognito and signed-out tabs;
  - cache hit makes no request, and a hit expires at 5 minutes;
  - debounce;
  - the soft cap;
  - a 429 pauses checks;
  - `markSaved` updates the cache.
- `apps/extension/__tests__/background/commands.test.ts`: `save-page` queues a save with `source: "shortcut"`, and the validator accepts it.
- e2e: none. Extensions don't load in the e2e suite. Record the proof by hand.

## Proof before the PR

- **Video 1:** on a fresh article, press ⌥⇧S. Show "…" then "✓", then open the web app to show the card.
- **Video 2:** switch tabs between a saved and an unsaved page while the network panel shows one request per new URL, then press ⌥⇧S on a `chrome://` page.
- **Screenshots** in Chrome and Firefox, on light and dark toolbars:
  - the badge states "✓", "…" and "!";
  - the tooltip text;
  - the browser's shortcut settings page showing "Save this page to Teak".

## Release gate

1. Run `bun run --cwd apps/extension test` plus the repo checks, and break each new test on purpose.
2. Seed `extension-badge`, run the break-it pass, and fix and add regression tests until it is clean.
3. Send the proof bundle to the owner.
4. Merge, then release the extension per `apps/extension/release.md`. The store review includes the privacy practices change. Smoke-test the published build.

## Risks And Open Questions

- **Privacy trade-off.** The owner chose per-tab checks over a local hash list, so visited URLs reach Teak while signed in. Logging must not keep the `url` query string of `/v1/cards/duplicate`: check the Files Worker access logs and PostHog proxying.
- **Open decision (default: "✓" badge text).** Chrome badges show at most about 4 characters. A coloured dot would need a blank text and only a background colour, which reads poorly on some toolbars.
- **Open decision (default: Safari not in this phase).** Safari web extensions support `commands` and `setBadgeText`, but Teak's Safari extension is a separate native target with no `tabs` permission.
- **Open decision (default: archived cards show "✓").** They are in Teak; trashed cards don't count.
- **Chrome Web Store re-review.** The change in data use may slow the extension update.
