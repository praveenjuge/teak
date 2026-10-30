# Raycast

The Teak Raycast extension saves and finds cards from the keyboard. Search Cards, Favorites, Browse Folders, Browse Tags, Random Cards and Find Similar Cards list cards; a card's actions archive it, mark a link done, put it in a folder, find similar cards, refresh its details and edit it. Quick Save and Save to Teak take optional tags and a note. The AI tools (Search Teak Cards, List Teak Folders, Update Teak Card and the rest) act on the same vault through the public API.

## Sub-features

- `ray-search` searches with qualifiers (`is:archived`, `is:done`, `is:todo`, `like:`, `mood:`, `text:`, `price:`, `folder:`, `sort:shuffle`) and the Filters actions, including Shuffle, Show Archive, Filter by Progress and Save Search as Smart Folder….
- `ray-card-actions` archives and unarchives, marks a link read, watched, bought or done, finds similar cards, adds to a folder and refreshes details.
- `ray-folders` lists manual and smart folders (Browse Folders) and opens one as a card list.
- `ray-random` shows 20 shuffled cards with Keep and Archive Card.
- `ray-similar` finds similar cards from the action or from the Find Similar Cards command with an ID or a Teak link.
- `ray-detail` shows `[[` links by title, Linked from, price, category, byline, published date, saved-from source and the done row.
- `ray-tags` renames, merges and deletes tags and waits for the background change.
- `ray-save` sends tags and a note with Quick Save and Save to Teak. Quick Save fills Content from copied text, never from a copied file's name.
- `ray-resave` saves a link that's already in Teak (Save Current Browser Tab, Save Clipboard, Save Selected Text, Save to Teak, Quick Save) with one `POST /v1/cards` and no duplicate check first. `resaved: true` shows the toast "Already saved" with "Moved to the top" ("Moved back from Archive" for an archived card) and **Open Card**; the AI save tool answers "Already in Teak, moved to the top: <id>". Lists place an upserted card by `savedAt ?? createdAt`.
- `ray-hidden` explains an empty list when cards are hidden, and how to find a card just tagged `secret` or `hidden`.
- `ray-ui` is the list and detail layout: the type menu beside the search bar (in step with `type:`), section titles with a card count, thumbnails for images and the first color for palettes, a `+N` tag behind the first tag, the saved date (`savedAt ?? createdAt`), actions grouped open → Card → Filters → Copy → Move to Trash → Account, and Reload, Clear Filters, Leave Archive or Leave Trash, Open Teak and Sign Out on an empty or failed list. A signed-out command opens Raycast's **Sign in with Teak** prompt straight away, except right after Sign Out in that command, which shows "You're signed out." with Sign in with Browser.
- `ray-ai` runs the AI tools: `search-cards` (`similarTo`, `done`, `mood`, `archived`, `folder`, `sort`), `list-folders` and `update-card` (`done`, `archived`, `addToFolder`).

## How to get to it (user POV)

- Raycast root search → Search Cards, Favorites, Browse Folders, Browse Tags, Random Cards, Find Similar Cards (argument: card ID or Teak link), Quick Save, Save to Teak (arguments: content, tags, note).
- In a card list: ⌘K for the actions: Archive Card (⌘⇧A), Mark as Read/Watched/Bought/Done (⌘⇧D), Find Similar (⌘⇧S), Add to Folder… (⌘⇧F), Refresh Details (⌘R); Filters → Show Archive, Filter by Progress, Sort Results → Shuffle, Save Search as Smart Folder….
- In Browse Tags: Rename Tag (⌘E), Merge into… (⌘⇧M), Delete Tag (⌃X).
- In any card list: ⌘P opens the type menu; Copy URL (⌘⇧C), Copy Teak Link (⌘⇧L), Sign Out (⌘⇧X).
- Raycast AI: `@teak` with the tools above.

## Driving it with Raycast and a Bun script

Preconditions:

- The E2E stack is running (`.agents/.state/stack.json` has `mode: "e2e"` and `ready: true`; never start or stop it for this). A free account is capped at 200 active cards, so seed a second account for anything that saves cards.
- An emulator user with a Teak account and an API key (`createSession` in `apps/apple/scripts/e2e-session.ts`, then `api.apiKeys.createUserApiKey`). Seed it from `packages/convex` with `env -u CONVEX_DEPLOY_KEY CONVEX_AGENT_MODE=anonymous bunx convex run devSeed:seed '{"workosUserId":"<id>"}'` and `devSeed:seedScenario` for `archive-mix`, `smart-folders`, `done-states` and `card-links`.
- A copy of `apps/raycast` outside the monorepo with `npm ci` run, so `teak-sdk` is the published version the extension ships with.

Steps:

- **Checks.** `bun run --cwd apps/raycast test`, `typecheck`, `lint`, `build`. In the copy: `npx tsc --noEmit`, `npx ray build` and `bun test src/__tests__ --isolate` (all pass). The table copies are checked by `scripts/raycast-parity.test.ts` in the monorepo.
- **API calls.** Write a Bun script outside the repo that mocks `@raycast/api` (`environment.isDevelopment: true`, `getPreferenceValues` returning the key, `showToast` and `open` stubs), sets `TEAK_DEV_API_URL` to the stack's `apiOrigin`, and imports `src/lib/api.ts` from the copy. Call `setCardArchived`, `searchCards` (with `archived: "only"`, `sort: "shuffle"` and a `shuffleSeed`, `folder`, `similarTo`), `setCardDone`, `listFolders`, `addCardToFolder`, `createSmartFolder`, `refreshCard`, `runTagOperation` and `quickSaveCard` with `parseCaptureExtras`. Print each result with the key as `<redacted>`.
- **Proof.** Save the output to `.agents/.state/verify/<run-id>/raycast/api-proof.txt`: an archived card leaves the default list and shows under `archived: "only"`; the same seed gives the same order and a new one differs; a card shows in its folder's list, a smart folder lists what its search finds and refuses cards (`SMART_FOLDER`); a link's `completedAt` is set then null and `is:done` lists it; a rename, merge and delete each end `completed`; a card saved with tags and a note reads back with both; tagging `Secret` sets `isHidden` and removes the card from the default list.
- **Re-save.** On the second account, seed `resave` ([api-cli-mcp](./api-cli-mcp.md), **Re-save**). In the same script, also mock `BrowserExtension.getTabs` (one active tab, `https://example.com/resave/045`, archived in the pack), `environment.canAccess` (true) and `showToast` returning a toast object you keep, wrap `fetch` to log each request's method and path, then run the default export of `src/save-current-browser-tab.ts` from the copy. One `POST /v1/cards`, no `GET /v1/cards/duplicate`, and the last toast reads "Already saved" / "Moved back from Archive"; run it again for "Moved to the top". `GET /v1/cards?limit=1` lists that card first, and `GET /v1/cards?q=resave/045` lists one card. `apps/raycast/src/__tests__/capture.test.ts` covers the same flow with the network mocked.
- **Rendering.** `apps/raycast/src/__tests__/cardsListCommand.test.tsx` renders the card list and presses its actions with `@raycast/api` mocked. In the Raycast app, `bun run --cwd apps/raycast dev` loads the extension, which needs a signed-in Raycast and uses the shared dev deployment unless `TEAK_DEV_API_URL` reaches the extension.
- **In the Raycast app.** With `bun run --cwd apps/raycast dev` running, open a command with `open "raycast://extensions/praveenjuge/teak-raycast/<command>"`; choose **Always Run Command** the first time Raycast asks. Send keys with System Events (`osascript -e 'tell application "System Events" to keystroke "k" using command down'`) only while Raycast is frontmost, since Raycast hides when it loses focus and the keys would go to another app. Background key events hide Raycast too. Capture the window with `screencapture -x -o -l<id>` (the CoreGraphics window named "Main Window"); action panels and dropdowns are their own windows, so capture the screen area (`screencapture -R`) to include them. A signed-out command opens Raycast's sign-in prompt; a person finishes the browser sign-in, then seed that account (`devSeed:seed` and the packs above) to see cards. For each `ray-ui` state, capture the list, ⌘K, ⌘P, a link's detail, an empty Archive and Trash, a search with no results, Browse Tags, Browse Folders, Random Cards and the signed-out prompt.
- **Cleanup.** Restore every seeded card you changed (tags, archive, folders, done), delete the smart folder you made, and permanently delete the cards you saved.

## Gotchas

- `bun run dev` for the extension opens the Raycast app if it is closed, and leaves the extension in Raycast's development list until you remove it there.
- Bun resolves `teak-sdk` to the workspace copy inside the monorepo, so a call the published SDK lacks only fails in the copy outside it.
- The local API rate-limits bursts with "Too many requests"; wait a few seconds and retry. A second Refresh Details on the same card within a minute answers 429 "already refreshing".
- A search with a `like:` qualifier or `similarTo` keeps the API's closest-first order unless a sort is set, so the extension sends no sort for it.
- Marking a card that isn't a link done answers 400 "Only link cards can be marked done"; the extension hides the action for other types.
- Free accounts stop saving at 200 active cards; the seeded packs pass that, so use a second account for saves.
- The default seed has no priced links, so `price:` and the price row need a link whose page has a price, such as a real product page.
- Never paste the key into notes, PRs or chat. Write `<redacted>`.
