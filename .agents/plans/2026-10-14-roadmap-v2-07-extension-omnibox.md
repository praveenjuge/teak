## Goal

Search Teak from the browser's address bar. Type `teak`, a space, and a query to see your top matching cards as suggestions. Choosing one opens it in Teak; pressing Enter opens the full search. Phase 7 of the [roadmap v2](2026-10-14-roadmap-v2-00-roadmap.md).

## Depends on

- [Phase 4](2026-10-14-roadmap-v2-04-hidden-cards.md): hidden cards stay out of the suggestions because `GET /v1/cards` leaves them out.

## Success Criteria

- The manifest declares the keyword `teak`. In Chromium browsers and Firefox, typing `teak` and Tab or Space enters Teak mode.
- After 2 or more characters, with typing debounced by 250 ms, up to 5 suggestions arrive from `GET /v1/cards?q=…&limit=5`. Each shows the card title, its type and its host.
- Choosing a suggestion opens its `appUrl` (`https://app.teakvault.com/?card=<id>`). Enter on the typed text opens `https://app.teakvault.com/?q=<text>`. Both open in the current tab, or in a new tab with Alt/⌘, following `OnInputEnteredDisposition`.
- **Signed out:** the default suggestion reads "Sign in to Teak to search", and Enter opens the extension's sign-in.
- Qualifiers work (`#tag`, `type:image`, `site:`) because the API parses them.

## Context And Current Facts

- `apps/extension/wxt.config.ts` builds the MV3 manifest (permissions: identity, storage, activeTab, tabs, contextMenus, scripting; `host_permissions: ["<all_urls>"]`, and a gecko id with `strict_min_version: "140.0"`). It has no `omnibox` key. WXT passes manifest keys through, so `omnibox: { keyword: "teak" }` goes in the `manifest` object.
- `entrypoints/background.ts` (647 lines) is the MV3 service worker. It already registers `contextMenus` and `runtime.onMessage` listeners inside `defineBackground`, and calls the API through `oauthRequest(path, init, ownerId)` (`lib/oauthAuth.ts:375`). `getOAuthState()` (line 418) calls `/v1/me` to check sign-in, and `beginOAuthSignIn()` (line 246) starts sign-in.
- `GET /v1/cards` takes `q` and `limit` (`publicApiHttpCards.ts`, `parseCardsQueryOptions`). Each item carries `appUrl` built by `getCardAppUrl` (`publicApiHttpValidation.ts:63`) as `<app>/?card=<id>`, plus `metadataTitle`, `type` and `url`.
- The public API allows 120 requests per minute per user (`shared/rateLimits.ts` `publicApiRequests`), and errors have the body shape `{error, code}`.
- The popup's app URL is a constant: `APP_URL` in `entrypoints/popup/App.tsx:29-31` (`https://app.teakvault.com`, or the dev app URL in dev).
- **Chrome** `omnibox.SuggestResult.description` is XML: `<match>`, `<dim>` and `<url>` tags, and `&`, `<`, `>`, `"` and `'` must be escaped, or the call throws. **Firefox** shows the description as plain text.
- Analytics: the extension sends errors, `extension_card_saved` and `signed_in` (`lib/telemetry.ts`, `.agents/analytics.md`).

## Constraints And Non-goals

- Extension only. No backend change. The API, hidden-card filtering and qualifiers already exist.
- No search history and no recent cards (rejected). Nothing is stored about queries, and the query text never goes into telemetry.
- Requests are cancelled with `AbortController` when the input changes. Only the latest response is shown, and responses are not cached beyond the current input session.
- An `extension_omnibox_used { result: "card" | "search" }` event goes into `ClientEventCatalog` first.

## Backend

- `shared/analytics.ts`: add the `extension_omnibox_used` client event only.

## Web

- None. `/?q=` and `?card=` already work.

## Extension

- `wxt.config.ts`: `omnibox: { keyword: "teak" }`.
- `lib/omnibox.ts`, pure functions:
  - `buildSuggestions(items, browser)` escapes the XML for Chromium and returns plain text for Firefox, truncating titles to 80 characters.
  - `searchUrl(appUrl, text)` and `debounceInput`.
- `lib/appUrl.ts`: moves `APP_URL` out of the popup so the background can use it.
- `entrypoints/background.ts`:
  - `chrome.omnibox.onInputStarted` checks the auth state.
  - `onInputChanged(text, suggest)` debounces, calls `oauthRequest('/v1/cards?q=…&limit=5')` and calls `suggest`.
  - `setDefaultSuggestion` reads "Search Teak for "%s"", or the sign-in text.
  - `onInputEntered(text, disposition)`: an `appUrl` from a suggestion opens it, after checking it is on the app origin; anything else opens the search. Tabs open through `chrome.tabs.update` / `create`.

## API / MCP / SDK / CLI

- None.

## Docs

- `(apps)/extension.mdx`: an "Address bar search" section.
- Ship-month changelog: "Search Teak from your browser's address bar".

## UI states

- **Empty:** fewer than 2 characters shows only the default suggestion, "Search Teak for "…"". No results shows the default plus one dim line, "No matching cards".
- **Loading:** the browser keeps the last suggestions until new ones arrive. There is no spinner to draw.
- **One / many items:** 1 result is one row. With 1,000 matches, it shows 5 rows plus the Enter-to-search default.
- **Very long names:** 300-character, emoji, RTL and CJK titles are cut to 80 characters with an ellipsis. Escaping is tested with `&`, `<script>` and quotes.
- **Error:**
  - A network or 5xx error shows the default suggestion with "Couldn't reach Teak", and Enter still opens the web search.
  - A 401 shows the sign-in text.
- **Rate-limited:** a 429 shows "Too many searches, slow down"; it clears on the next input after 5 s.

## Scenario seed packs

- `ordering` (1,000 cards) for many results.
- `omnibox-titles`: 10 cards whose titles have `&`, `<`, `>`, quotes, a 300-character title, emoji, RTL, CJK and an empty title (shown as the host), plus one hidden card that must never appear.

## Break-it checklist

- **Extension:**
  - Type 20 characters fast (at most one request every 250 ms, and stale responses dropped).
  - Unicode and emoji queries.
  - `teak` followed only by whitespace.
  - A query of 500 or more characters.
  - Signed out, then sign in from the default suggestion.
  - Token expiry mid-session (`oauthRequest` refreshes).
  - Offline.
  - A 429 from rapid typing.
  - Enter with Alt (new tab).
  - A forged suggestion URL that is not on the app origin (refused).
- **Backend:** none new. Confirm `q` with qualifiers, hidden-card exclusion and that `limit=5` is honored.

## Tests

- `apps/extension/__tests__/lib/omnibox.test.ts`: a `test.each` over XML escaping (Chromium) and plain text (Firefox), truncation, empty titles, the search URL encoding, and refusing an off-origin suggestion URL.
- `apps/extension/__tests__/build/wxtConfig.test.ts`: the manifest has `omnibox.keyword === "teak"`.
- `packages/convex/__tests__/shared/analytics.test.ts`: the new event is typed.

## Proof before the PR

- **Video (Chrome):** `teak design`, suggestions appear, choose one, the card opens. Then Enter on the text opens the search.
- **Video, worst case:** typing fast, signed out, and the escaping title fixture.
- **Screenshots:** suggestions in Chrome, light and dark; no results; signed out; error; rate-limited.
- The captured `GET /v1/cards?q=…&limit=5` requests and responses.

## Release gate

1. Run the narrow tests, then the repo checks, plus `bun run --cwd apps/extension test` and `typecheck`.
2. Load the unpacked Chrome build and run the break-it pass. Do a quick Firefox check with `bun run --cwd apps/extension dev:firefox`; the full Firefox pass is phase 8. Fix and add regression tests.
3. Send the proof bundle.
4. Open the PR; CI must be green. Merge. Deploy Convex for the analytics catalog. Release the extension at the next lockstep patch (`apps/extension/release.md`). Smoke-test the store build.

## Risks And Open Questions

- **Keyword collisions.** Only one extension can own a keyword. If another extension claims `teak`, the browser picks one, and nothing in our code can fix that.
- **Store review.** Chrome Web Store review of a new manifest key is usually quick. The keyword adds no permission, so the update needs no new permission consent from users.
