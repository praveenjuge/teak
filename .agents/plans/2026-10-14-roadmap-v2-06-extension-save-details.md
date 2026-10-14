## Goal

After the extension popup saves a page, let people add tags and a note on the spot. Right-click → Save Text also records the page the text came from, so a saved quote keeps its source. Phase 6 of the [roadmap v2](2026-10-14-roadmap-v2-00-roadmap.md).

## Depends on

- Nothing.

## Success Criteria

- **Tags and note:**
  - The popup still saves the page as soon as it opens. When the result is Saved or Already saved, it shows a tag input and a note field.
  - Tag suggestions are the user's most-used tags, plus the tags last used in the extension.
  - Changes are sent with `PATCH /v1/cards/:id` (`tags`, `notes`) when a field loses focus, on Enter in the tag input, and when the popup closes.
  - Once a field has focus, the popup no longer closes by itself.
- **Source for Save Text:**
  - The card gets optional `sourceUrl` and `sourceTitle`.
  - `site:example.com` finds it, the card details show "From example.com", and the text card in the grid shows the host in its footer.
  - The duplicate-URL check (`by_user_url_deleted`) never looks at `sourceUrl`.
- `sourceUrl` and `sourceTitle` work in `POST /v1/cards`, OpenAPI, MCP `teak_v1_create_card`, the SDK and `teak add --source-url <url> --source-title <title>`. They appear in the card JSON and in exports.

## Context And Current Facts

- **Popup** (`entrypoints/popup/App.tsx`, 470 lines). `AuthenticatedPopup` (line 274) uses `useAutoSaveUrl` (`hooks/useAutoSaveUrl.ts`). That hook sends `SAVE_CONTENT {content: tab.url, source: "popup-auto-save"}` to the background and **drops the `cardId`** from a `saved` response: it only does `setState("success")`.
- **Auto-close.** `lib/popupStatus.ts` sets `autoClose: true` for a successful auto-save, a context-menu save and a file upload. `AuthenticatedPopup` then calls `window.close()` after 2 s.
- **Saving** (`lib/saveToTeak.ts`). A URL first calls `GET /v1/cards/duplicate?url=`, and then `POST /v1/cards` with `{url}`; text is sent as `{content, cardType: "text"}`. The `duplicate` response carries the existing `cardId`.
- **Context menu.** `entrypoints/background.ts` `extractContextMenuContent` (around lines 219–270) returns only the selection or the tab title for `save-text`, so `tab.url` and `tab.title` are lost. Saves are queued as `PendingSave` (`lib/pendingSaves.ts`) in `chrome.storage` and retried, so a stored entry written by an older build has no source fields.
- **API.** `PATCH /v1/cards/:id` already accepts `notes` and `tags` (each tag at most 64 characters; `publicApiHttpCards.ts` around line 553). `POST /v1/cards` already has an unrelated `source` key: a free string that becomes `metadata.source` (`CREATE_KEYS`, `publicApiHttpValidation.ts:230`; `raycast.quickSaveForUser`). `GET /v1/tags` returns `{name, count}` items sorted **by name**, with no "recent" order, and includes AI tags (`publicApi.listTagsForUser`).
- **Site host.** `urlHost` comes from `card.url` only: `withUrlHost` and `syncCardSearchDocumentHandler` (`card/searchDocumentHelpers.ts:194` and `:291`), both via `normalizeUrlHost`. `card/topSites.ts` counts hosts for `site:` suggestions.
- **Serializers.** API JSON comes from `serializeCard` / `serializeListCard` in `publicApiHttpValidation.ts:105`, exports from `export/serialize.ts:141`, and MCP create arguments from `mcp/tools.ts` (around line 142).
- **Rate limits.** The public API allows 120 requests per minute (`shared/rateLimits.ts` `publicApiRequests`). Card creation allows 30 per minute.

## Constraints And Non-goals

- Two optional card fields, `sourceUrl: v.optional(v.string())` and `sourceTitle: v.optional(v.string())`, set only at create. The URL must be http or https, at most 2,048 characters. The title is trimmed and at most 300 characters. PATCH does not change them in this phase.
- `urlHost` comes from `url ?? sourceUrl`, in both `withUrlHost` and the search sync, so `site:` and top sites include sourced text cards.
- The popup never blocks the save on tags; the save happens first. Each patch is sent through the background (a new `PATCH_CARD` message), because the popup's context ends when it closes. The background retries once on a network error.
- Locally remembered tags are kept in `chrome.storage.local` (`teakRecentTags`, at most 20, per signed-in user). They are cleared on sign out.
- No page HTML is sent (rejected). The Safari toolbar is out of scope.

## Backend

- `schema.ts`: `cards.sourceUrl` and `cards.sourceTitle`.
- `publicApiHttpValidation.ts`: add `sourceUrl` and `sourceTitle` to `CREATE_KEYS` and `CREATE_STRING_KEYS`, validate them, and serialize them (both serializers).
- `raycast.ts` `createCardForUserArgs` / `quickSaveForUser` and `card/createCard.ts`: pass the fields through to the insert.
- `card/searchDocumentHelpers.ts`: host from `url ?? sourceUrl`. Add `sourceUrl` to `searchableFields`, so a change schedules the sync.
- `export/serialize.ts`: include both fields. `publicApiOpenApi.ts`: the create schema and the card schema.

## Web

- `card-modal/CardMetadataPanel.tsx`: a "From example.com" row, linked to `sourceUrl` through the existing safe-link opener, with `sourceTitle` as its tooltip.
- `cards/previews` (the text card footer): the muted host, using `hostForDisplay`.

## Extension

- `lib/saveToTeak.ts`: `SaveToTeakInput` gets `sourceUrl?` and `sourceTitle?`, sent only for text saves.
- `entrypoints/background.ts`:
  - `save-text` passes `tab.url` (when it's http or https) and `tab.title`.
  - A new `MESSAGE_TYPES.PATCH_CARD` with `{cardId, tags?, notes?}` calls `oauthRequest` `PATCH /v1/cards/:id`.
  - `isRuntimeRequest` checks the payload bounds.
- `hooks/useAutoSaveUrl.ts`: keeps `cardId` for both `saved` and `duplicate`.
- `entrypoints/popup/SaveDetails.tsx`:
  - A tag input with chips, a suggestion list (most-used tags from `GET /v1/tags`, sorted by `count`, merged with the recent tags) and a note `textarea`.
  - For a duplicate it loads the card (`GET /v1/cards/:id`) and pre-fills its own tags and notes.
- `lib/popupStatus.ts`: `autoClose` is false once the details are touched.

## API / MCP / SDK / CLI

- `POST /v1/cards` adds `sourceUrl` and `sourceTitle`.
- MCP `teak_v1_create_card` gets both fields.
- `packages/convex/client/sdk.ts`: the `createCard` input and the `Card` type.
- `apps/cli/src/index.ts` `withAddOptions`: `--source-url` and `--source-title`.

## Docs

- `(apps)/extension.mdx`: "Add tags and a note after saving", and Save Text keeps the page link.
- `features.mdx`: one sentence on sources.
- `(developers)/api.mdx`, `mcp.mdx` and `(apps)/cli.mdx`.
- Ship-month changelog.

## UI states

- **Empty:** a new card shows an empty tag input, "Add tags", and a note field, "Add a note". Suggestions show only once the input has focus.
- **Loading:** while the save is running, the details are hidden. For a duplicate, two skeleton lines show while the card loads.
- **One / many items:** 0 tags shows no suggestions. 50 recent tags and 2,000 library tags: 8 suggestions, filtered as you type.
- **Very long names:** a 64-character tag truncates in its chip. A 10,000-character note scrolls inside the field, which is capped at 6 lines. A 300-character page title is truncated in the "From" row.
- **Error:**
  - A failed PATCH shows an inline "Couldn't save tags. Retry", and the popup stays open.
  - A tag over 64 characters is refused inline before any request.
- **Rate-limited:** a 429 shows "Too many requests. Try again in a moment" and keeps the typed values. At the free-plan card limit, the existing upgrade status shows and there are no details.
- **UI bar:** the details fade in over 150ms below the status line, inside the existing 360px popup. The note saves quietly and shows a "Saved" tick for 1 s.

## Scenario seed packs

- `tags-2000` for suggestions, and an account at 199 cards for the limit.
- Test pages (local fixtures):
  - a 10,000-character selection
  - an empty selection
  - a selection inside an iframe
  - the Chrome PDF viewer
  - `chrome://extensions`
  - a page with an RTL title and a 300-character title
  - a selection that is a bare URL (saved as a link, with no source)

## Break-it checklist

- **Extension:**
  - Close the popup while typing a note (the patch must land).
  - Type tags in two popups opened one after the other.
  - Sign out mid-edit.
  - Run out of card space during the save.
  - Duplicate pages.
  - Save Text on a restricted page (refused, as today).
  - A pending save written by an older build (no source fields) replays fine.
  - Offline: the save queues, and the details stay hidden until it's saved.
- **Backend:**
  - Bad `sourceUrl` (`javascript:`, 3,000 characters, not a string).
  - `sourceUrl` with `url` on a link card (allowed; `url` wins for the host).
  - `site:` finds sourced text cards.
  - Another user's `cardId` in the PATCH.
  - An idempotent create retry keeps the source.

## Tests

- `apps/extension/__tests__/lib/saveToTeak.test.ts`: the text body includes the source fields, and URL saves never do.
- `apps/extension/__tests__/hooks/useAutoSaveUrl.test.ts`: `cardId` is kept for saved and duplicate.
- `apps/extension/__tests__/lib/popupStatus.test.ts`: no auto-close once the details are dirty.
- `apps/extension/__tests__/lib/recentTags.test.ts`: merge and cap, cleared on sign out.
- `packages/convex/__tests__/publicApiHttpValidation.test.ts`: `sourceUrl` and `sourceTitle` validation table.
- `packages/convex/__tests__/publicApiHttpCards.test.ts`: create with a source; the JSON includes it.
- `packages/convex/searchQualifiers.test.ts` (convex-test): `site:` finds a sourced text card, and the duplicate check ignores `sourceUrl`.
- `packages/convex/__tests__/mcp.test.ts`, `__tests__/sdk.test.ts` and `apps/cli/src/commands.test.ts` (`--source-url`).

## Proof before the PR

- **Video:** open the popup on an article; it saves; add two tags and a note; close; the card in the web app has them.
- **Video:** Save Text on a page; the card shows "From example.com"; `site:example.com` finds it.
- **Video, worst case:** close the popup mid-typing, a duplicate page with prefilled details, the card limit.
- **Screenshots:** the popup saved with details, a duplicate, the PATCH error, the limit; the modal's "From" row; the grid footer. Light and dark. The popup at its native width, the web app at 390px and 1440px.
- Captured `POST /v1/cards` with a source, `teak add "quote" --source-url …` output, and the MCP create call.

## Release gate

1. Run the narrow tests, then the repo checks, plus `bun run --cwd apps/extension test`, `03-api.e2e.ts`, `04-cli.e2e.ts`, `05-mcp.e2e.ts` and `packages/tests/src/extension/oauth-runtime.e2e.ts`.
2. Load the unpacked Chrome build against the dev deployment, run the break-it pass, then fix and add regression tests.
3. Send the proof bundle.
4. Open the PR; CI must be green. Merge. Deploy Convex first (the new optional fields), then the web app. Release the extension through `apps/extension/release.md` at the next lockstep patch version. No backfill. Smoke-test production with the store build once it is approved.

## Risks And Open Questions

- **Naming.** The API's existing `source` key (`metadata.source`) sits next to the new `sourceUrl` and `sourceTitle`. The docs must keep them apart, or the new fields could be named `fromUrl` / `fromTitle`. The owner should decide before the API ships.
- **Patch on close.** Chrome may drop a message sent while the popup is closing. Send the patch on every blur and on `pagehide`, and confirm in Chrome and, later, in Firefox (phase 8).
