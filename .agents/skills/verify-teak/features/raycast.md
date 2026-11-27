# Raycast

The Teak Raycast extension saves and finds cards from the keyboard: commands that list cards, card actions, Quick Save, Save to Teak, and AI tools (Search Teak Cards, List Teak Folders, Update Teak Card and the rest) on the same vault through the public API.

## Sub-features

- `ray-search` searches with qualifiers (`is:archived`, `is:done`, `is:todo`, `like:`, `mood:`, `text:`, `price:`, `folder:`, `sort:shuffle`) and the Filters actions.
- `ray-card-actions` archives and unarchives a card and runs the other ⌘K card actions.
- `ray-folders` lists manual and smart folders and opens one as a card list.
- `ray-random` shows 20 shuffled cards with Keep and Archive Card.
- `ray-similar` finds similar cards from the action or the command.
- `ray-detail` shows `[[` links by title (in code, indented blocks included, the token stays as written), Linked from, price, category, byline, published date, saved-from source and the done row.
- `ray-tags` renames, merges and deletes tags, waiting for the background change.
- `ray-save` sends tags and a note with Quick Save and Save to Teak; Quick Save fills Content from copied text, never from a copied file's name.
- `ray-resave` re-saves a link (Save Current Browser Tab, Save Clipboard, Save Selected Text, Save to Teak, Quick Save) with one `POST /v1/cards`, no duplicate check. `resaved: true` shows the toast "Already saved" with "Moved to the top" ("Moved back from Archive" for an archived card) and **Open Card**; the AI save tool answers "Already in Teak, moved to the top: <id>". Lists place it by `savedAt ?? createdAt`.
- `ray-trash-undo` keeps a trashed card out of Search Cards, Favorites and Random Cards even when a favorite saved just before answers late or a reload lands first; only the Moved to Trash toast's Undo puts it back, where it sat.
- `ray-hidden` explains an empty list of hidden cards, and how to find a card just tagged `secret` or `hidden`.
- `ray-ui` is the layout: the type menu beside the search bar (in step with `type:`), section titles with a card count, image thumbnails and a palette's first color, a `+N` tag behind the first tag, the saved date (`savedAt ?? createdAt`), actions grouped open → Card → Filters → Copy → Move to Trash → Account, and Reload, Clear Filters, Leave Archive or Leave Trash, Open Teak and Sign Out on an empty or failed list. Signed out, a command opens Raycast's **Sign in with Teak** prompt, except right after its own Sign Out: "You're signed out." with Sign in with Browser. A browser sign-in the API rejects says "Your Teak sign-in has expired or was disconnected. Sign in again to continue."; only an API key from preferences gets "Your Teak API key is invalid or revoked…".
- `ray-ai` runs the AI tools `search-cards` (`similarTo`, `done`, `mood`, `archived`, `folder`, `sort`), `list-folders` and `update-card` (`done`, `archived`, `addToFolder`).

## How to get to it (user POV)

- Raycast root search → Search Cards, Favorites, Browse Folders, Browse Tags, Random Cards, Find Similar Cards (argument: card ID or Teak link), Quick Save, Save to Teak (arguments: content, tags, note).
- In a card list: ⌘K for the actions: Archive Card (⌘⇧A), Mark as Read/Watched/Bought/Done (⌘⇧D), Find Similar (⌘⇧S), Add to Folder… (⌘⇧F), Refresh Details (⌘R); Filters → Show Archive, Filter by Progress, Sort Results → Shuffle, Save Search as Smart Folder….
- In Browse Tags: Rename Tag (⌘E), Merge into… (⌘⇧M), Delete Tag (⌃X).
- In any card list: ⌘P opens the type menu; Copy URL (⌘⇧C), Copy Teak Link (⌘⇧L), Sign Out (⌘⇧X).
- Raycast AI: `@teak`.

## Driving it with Raycast and a Bun script

Preconditions:

- The E2E stack is running (`.agents/.state/stack.json`: `mode: "e2e"`, `ready: true`; never start or stop it).
- An emulator user with a Teak account and an API key (`createSession` in `apps/apple/scripts/e2e-session.ts`, then `api.apiKeys.createUserApiKey`). Seed it from `packages/convex`: `env -u CONVEX_DEPLOY_KEY CONVEX_AGENT_MODE=anonymous bunx convex run devSeed:seed '{"workosUserId":"<id>"}'` and `devSeed:seedScenario` for `archive-mix`, `smart-folders`, `done-states` and `card-links`.
- A copy of `apps/raycast` outside the monorepo with `npm ci` run, for the published `teak-sdk` (see Gotchas).

Steps:

- **Checks.** `bun run --cwd apps/raycast test`, `typecheck`, `lint`, `build`; in the copy, `npx tsc --noEmit`, `npx ray build` and `bun test src/__tests__ --isolate`; all pass. `scripts/repo/raycast-parity.test.ts` checks the table copies.
- **API calls.** A Bun script outside the repo mocks `@raycast/api` (`environment.isDevelopment: true`, `getPreferenceValues` returning the key, stub `showToast` and `open`), sets `TEAK_DEV_API_URL` to the stack's `apiOrigin`, and imports `src/lib/api.ts` from the copy. Call `setCardArchived`, `searchCards` (with `archived: "only"`, `sort: "shuffle"` and a `shuffleSeed`, `folder`, `similarTo`), `setCardDone`, `listFolders`, `addCardToFolder`, `createSmartFolder`, `refreshCard`, `runTagOperation` and `quickSaveCard` with `parseCaptureExtras`. Print each result with the key as `<redacted>`.
- **Proof.** Save the output to `.agents/.state/verify/<run-id>/raycast/api-proof.txt`. An archived card leaves the default list and shows under `archived: "only"`; one `shuffleSeed` repeats its order and a new one differs; a card shows in its folder, a smart folder lists its search's results and refuses cards (`SMART_FOLDER`); a link's `completedAt` is set then null and `is:done` lists it; a rename, merge and delete each end `completed`; a card saved with tags and a note reads back with both; tagging `Secret` sets `isHidden` and drops it from the default list.
- **Re-save.** On the second account, seed `resave` ([api-cli-mcp](./api-cli-mcp.md), **Re-save**). In the same script, mock `BrowserExtension.getTabs` (one active tab, `https://example.com/resave/045`, archived in the pack), `environment.canAccess` (true) and `showToast` (keep the returned toast), log each `fetch`'s method and path, and run the default export of `src/save-current-browser-tab.ts` from the copy: one `POST /v1/cards`, no `GET /v1/cards/duplicate`, and the last toast reads "Already saved" / "Moved back from Archive"; again for "Moved to the top". `GET /v1/cards?limit=1` lists it first; `GET /v1/cards?q=resave/045` lists one card. `apps/raycast/src/__tests__/capture.test.ts` covers it with the network mocked.
- **Rendering.** `apps/raycast/src/__tests__/cardsListCommand.test.tsx` renders the card list and presses its actions with `@raycast/api` mocked, including a late favorite answer.
- **Trash after a late favorite.** In Search Cards press Favorite (⌘F) then Move to Trash (⌃X) at once, or in a card's details Favorite (⌘F), Escape, Move to Trash (⌃X). After a few seconds it's still gone; the toast's Undo (⌘Z) puts it back in place.
- **In the Raycast app.** `bun run --cwd apps/raycast dev` loads the extension (needs a signed-in Raycast; uses the shared dev deployment unless `TEAK_DEV_API_URL` reaches it). Open a command: `open "raycast://extensions/praveenjuge/teak-raycast/<command>"`; choose **Always Run Command** once. Send keys with System Events (`osascript -e 'tell application "System Events" to keystroke "k" using command down'`) only while Raycast is frontmost; it hides on losing focus or on background key events. Capture with `screencapture -x -o -l<id>` (the CoreGraphics window "Main Window"), or `screencapture -R` for action panels and dropdowns, which are separate windows. Signed out, a person finishes the browser sign-in; then seed that account as above. Capture each `ray-ui` state: the list, ⌘K, ⌘P, a link's detail, an empty Archive and Trash, a search with no results, Browse Tags, Browse Folders, Random Cards and the signed-out prompt.
- **Cleanup.** Restore changed seeded cards (tags, archive, folders, done), delete your smart folder, permanently delete your saved cards.

## Gotchas

- The extension's `bun run dev` opens Raycast and leaves the extension in its development list until removed there.
- Inside the monorepo Bun resolves `teak-sdk` to the workspace copy, so a call the published SDK lacks fails only in the outside copy.
- The local API rate-limits bursts ("Too many requests"); retry after a few seconds. A second Refresh Details within a minute answers 429 "already refreshing".
- A `like:` or `similarTo` search keeps the API's closest-first order unless sorted; the extension sends no sort for it.
- Marking a non-link done answers 400 "Only link cards can be marked done"; the extension hides the action for them.
- Free accounts stop saving at 200 active cards and the seeded packs pass that, so use a second account for saves.
- The default seed has no priced links; `price:` and the price row need a real product page link.
- Never paste the key into notes, PRs or chat; write `<redacted>`.
