# Browser extension

The Chrome and Firefox extension saves the current page when its popup opens, saves from the context menu, and saves the page with Alt+Shift+S (⌥⇧S on Mac) without opening the popup. Its toolbar icon shows "…" while a shortcut save runs, "✓" when it's done, and "!" for a few seconds with the reason when it can't save. While signed in, the icon also carries "✓" whenever the page in the current tab is already in Teak. Saving a page that's already in Teak moves its card to the top instead of making a second one.

## Sub-features

- `ext-sign-in` signs the extension in from the popup through the hosted AuthKit window.
- `ext-shortcut` saves the active tab with Alt+Shift+S: "…", then "✓" with the tooltip "Saved to Teak" (or "Already in Teak"), "!" with the reason on a page it can't save (`chrome://`, add-on stores, `file:`), and the popup when signed out or at the card limit (where the popup can't open, "!" with the tooltip "You've reached the free limit" / "Upgrade to Pro for unlimited cards." in the account's language). Two quick presses on one page make one card.
- `ext-resave` saves a page that's already in Teak (popup auto-save, context menu, inline buttons or the shortcut) with one `POST /v1/cards` and no duplicate check first: the answer's `resaved: true` shows "Already in your Teak" in the popup ("Already in Teak" on the icon), and the card moves to the top of the library and out of Archive. No second card is made.
- `ext-badge` shows "✓" and "Already in Teak" on a tab whose page is in Teak, checked when a tab is activated, finishes loading or its window gains focus, and cached for five minutes per address. Incognito tabs and browser pages are never checked; sign-out clears every badge.

## How to get to it (user POV)

- Toolbar icon → popup → **Sign in**.
- Any web page → Alt+Shift+S (⌥⇧S on Mac). Change it at `chrome://extensions/shortcuts` (**Save this page to Teak**) or Firefox's **Manage Extension Shortcuts**.
- Switch tabs, load a page or return to the window, then hover the Teak icon for its tooltip.

## Driving it with Playwright, Xvfb and xdotool

Preconditions:

- The dev stack is running and the doctor passes. `bun run setup --target extension` has written `apps/extension/.env.local`, then `(cd apps/extension && bunx wxt build --mode development)` built `.output/chrome-mv3-dev`. A production build signs in against production; never use it.
- A virtual display (`Xvfb :99 -screen 0 1440x900x24 &`) and `xdotool` (`apt-get install -y xdotool`). Run every script with `DISPLAY=:99`.
- An API key from `scripts/api-key.ts mint`, to read saves back.

Steps (a Node script importing `node_modules/playwright-core`, written outside the repo):

- **Launch.** Make a fresh profile directory each run and write `Default/Preferences` as `{"extensions":{"pinned_extensions":["negnmfifahnnagnbnfppmlgfajngdpob"]}}` so the icon and its badge show on the toolbar. Then `chromium.launchPersistentContext(profile, { headless: false, viewport: null, args: ["--disable-extensions-except=<build>", "--load-extension=<build>", "--window-size=1440,900"] })`, and take the service worker from `context.serviceWorkers()` or the `serviceworker` event.
- **`ext-sign-in`.** Open `chrome-extension://<id>/popup.html`, click button "Sign in", and take the AuthKit window from the context's `page` event. Fill textbox "Email" with the stack account, click "Continue with email", fill textbox "Password", click "Sign in". The window closes; the popup now shows the page it saved (its icon, title and site), and button "Menu" (⋯) opens a menu with the account's email and menu items "Open Teak", "Upload file" and "Sign out".
- **Read the icon.** In the service worker: `chrome.tabs.query({ active: true, lastFocusedWindow: true })`, then `chrome.action.getBadgeText({ tabId })` and `chrome.action.getTitle({ tabId })`. For a picture, `import -window root shot.png` and crop the top 90 px. `ffmpeg -f x11grab -framerate 15 -video_size 1440x900 -i :99 out.mp4` records the whole window, toolbar included.
- **`ext-shortcut`.** Open a page with the run marker in its address (`https://example.com/?verify-<run-id>=1`). Press the shortcut with a real key event: `xdotool search --onlyvisible --class chromium | tail -1 | xargs -I{} xdotool windowfocus {}; xdotool key alt+shift+s`. Within 300 ms the icon reads "…" / "Saving to Teak…", then "✓" / "Saved to Teak". Read it back: `GET /v1/cards/duplicate?url=<page>` returns a `cardId`, and the web app finds the card. On `chrome://version` the icon reads "!" with "Cannot save content from chrome: pages…", and is clear again 5 seconds later. Press twice in a row on a new page; `GET /v1/cards?q=verify-<run-id>` lists one card for it. At the limit: seed `card-limit-199` on the account, save one page, then press the shortcut on another page: the popup opens with "You've reached the free limit". In the service worker, `chrome.action.openPopup = () => Promise.reject(new Error("no gesture"))` first and press again: `getTitle` reads the same two lines, and in German (Settings → Appearance → Deutsch, then reopen the popup so `/v1/me` stores it) "Sie haben das kostenlose Limit erreicht".
- **`ext-resave`.** Seed `resave` ([api-cli-mcp](./api-cli-mcp.md), **Re-save**) on the signed-in account and log context requests whose URL has `/v1/cards`. Open `https://example.com/resave/030` (an archived card) and open the popup: one `POST /v1/cards` and no `GET /v1/cards/duplicate` from the save, and the popup reads "Already in your Teak". Read it back: `GET /v1/cards?limit=1` lists that card first with `isArchived: false`, and `GET /v1/cards?q=resave/030` lists one card. Press the shortcut on the same page: "✓" / "Already in Teak", still one card.
- **`ext-badge`.** Set `PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1` and log context requests whose URL has `/v1/cards/duplicate`. Open a page saved in an earlier run: "✓" / "Already in Teak" after one request. Open an unsaved page: no badge, "Save to Teak". Switch between the two with `bringToFront()` a few times: the badge follows, and no new requests are sent.
- **Cleanup.** Delete every card whose address has the run marker (`DELETE /v1/cards/<id>`, then `?permanent=true`), revoke the key, delete the profile directory, and stop Xvfb.

## Gotchas

- Chrome keeps an unpacked extension's old service worker across launches of the same profile, so a rebuilt extension keeps running the previous build. Use a fresh profile for every run; `chrome.runtime.reload()` doesn't bring a `--load-extension` build back.
- Playwright's `page.keyboard.press` goes to the page, not the browser, so it never fires an extension shortcut. Only a real X key event (`xdotool`) does.
- The release bundle is minified, so grep the source, not `background.js`, to see what's built.
- The badge also checks `http://localhost` pages, which the API refuses (400), so the web app's tab shows no badge.
- Firefox, Safari and incognito windows aren't reachable this way. Firefox needs its own run in Firefox; the incognito skip is covered by `apps/extension/__tests__/lib/savedPageCheck.test.ts`.
