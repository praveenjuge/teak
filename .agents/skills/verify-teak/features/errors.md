# Errors and resilience

When a read fails, a save fails or the connection drops, Teak says what happened where it happened and keeps what the person made: a page that can't load shows an error inside the app with the sidebar still there, folders that can't load fail inside the sidebar, Tags stops loading after a few tries and offers "Try again", an audio recording that can't be saved stays in its dialog to save again or download, images ask for a fresh link before giving up, cards a bulk delete couldn't remove stay selected, a failed sign-out says so, and going offline is announced.

## Sub-features

- `errors-page` shows "Something went wrong. Please try again." with "Try again" (which reloads) in place of a page that fails to render, inside the app: the sidebar, or on phones its toggle, stays. Settings pages show it under the Settings header.
- `errors-sidebar-folders` shows "Couldn't load your folders." with "Try again" in the sidebar's Folders group when folders can't be read; the views above it keep working (nothing in the collapsed rail).
- `errors-tags-summary` stops Tags' loading skeleton after two failed attempts to build the tag summary, or 45 seconds without one, and shows "Couldn't load your tags." with "Try again". A summary that arrives later replaces it.
- `errors-recording-save` keeps an audio recording whose save failed: the "Recording audio" dialog stays open saying "Couldn't save the recording. Try again, or download it to keep it." (or the card-limit or rate-limit reason) with "Discard", "Download" (a `recording_<time>.webm` or `.m4a` file) and "Try again". "Stop and Save" keeps the dialog open as "Saving recording…" until the save ends.
- `errors-media-refresh` asks once for a fresh link when media fails to load: a link tile then falls back to its screenshot, and the card dialog's image, video, GIF and audio player reload with the new link before saying they're unavailable.
- `errors-bulk-delete-forever` keeps the cards a bulk "Delete forever" couldn't delete selected ("1 card selected"), like every other bulk action.
- `errors-sign-out` shows "Failed to sign out. Please try again." when signing out fails from the command palette or the blocked-account screen, as Settings already did.
- `errors-offline` shows "You're offline. Changes will save when you reconnect." while the browser is offline, and a note saved meanwhile reads "You're offline. This note will save when you reconnect." until it saves.
- `errors-delete-account` never reports a failed deletion once the deletion went through (a failed sign-out afterwards goes to the sign-in page), and reopening "Delete account" starts without the last attempt's error.
- `errors-theme-toggle` (the palette's "Toggle theme") flips light and dark, and flipping back to the system's own goes back to "System" instead of fixing the theme for good.

## How to get to it (user POV)

- Any library page, `/tags` and Settings, when a read fails.
- The sidebar's Folders group.
- "New" → "Record audio" (or `R`), then "Stop and Save".
- Link tiles in the grid; an image, video or audio card's dialog.
- `/trash`: select cards, "Delete forever".
- Command palette (Ctrl+K): "Sign out", "Toggle theme".
- Any page while offline; the composer.
- Settings → Account → "Delete account".

## Driving it with Playwright

Failures come from `scripts/convex-faults.cjs`, which makes named Convex functions fail on one page's sync socket, and from `page.route` for images. Sign in first (save `storageState`), then per check:

- **Page.** `injectFaults(page, { failQuery: (n) => n === "listTagSummary" })`, open `/tags`: the alert "Something went wrong. Please try again." with "Try again", and link "Everything" still visible.
- **Folders.** `failQuery: (n) => n === "listFolders"`, open `/`: the alert "Couldn't load your folders." in the sidebar, "Everything" still visible.
- **Tags summary.** `rewriteQuery: (n) => (n === "listTagSummary" ? null : undefined)` and `failRequest: (n) => n === "requestTagSummary"`, open `/tags`, wait 9 s: no list "Loading tags", the alert "Couldn't load your tags." with "Try again".
- **Recording.** Chromium with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream` and the microphone permission; `failRequest: (n) => n === "uploadAndCreateCard"`. Press `r`, wait 2 s, "Stop and Save": dialog "Recording audio" stays with the message and "Discard", "Download", "Try again". "Download" fires a download; "Discard" closes it. Nothing is saved.
- **Link image.** Route the seeded "Tomato soup" link's preview image (its URL contains `link-preview-image%2F`) to 404 and `failRequest: (n) => n === "refreshCardMediaUrl"`; search `tomato`: the tile shows its screenshot, and no page error.
- **Dialog image.** Answer the "Coral lily" card's first `/detail/` image request with 403 and let the one with `teak_retry` through; open `/?card=<id>`: the image loads from the `teak_retry` URL.
- **Bulk delete forever.** Create two marked notes through the API and move both to Trash; `failRequest: (n, m) => n === "permanentDeleteCard" && JSON.stringify(m.args).includes(<first id>)`; in `/trash?q=<marker>` select both with `x`, Delete, "Delete forever": "1 card selected" and the first card pressed. Delete both for good through the API.
- **Sign out.** `page.route` POSTs with a `next-action` header to `abort()`; palette → "Sign out": toast "Failed to sign out. Please try again.", still on `/`.
- **Offline.** `context.setOffline(true)`: toast "You're offline. Changes will save when you reconnect."; save a marked note: "You're offline. This note will save when you reconnect."; `setOffline(false)`: "Saved". Delete the note for good.
- **Theme toggle.** `colorScheme: "light"`, theme left on System: palette → "Toggle theme" twice; `localStorage.theme` goes `dark`, then `system`.

## Gotchas

- Inject faults before the page's first navigation; the helper wraps the socket as it opens.
- Playwright's WebKit lets the clipboard be written after an await, which Safari doesn't, so copying an image works there before and after the fix; the unit test in `hooks/__tests__/useCardClipboard.test.ts` checks the write starts within the click.
- "Try again" on these errors reloads the page: the query cache would hand a plain retry the same error.
- The sign-out check really signs out if the route misses the request; sign in again (save new `storageState`) if it does.
- Deleting the account can't be driven on the shared dev account; `lib/__tests__/accountDeletion.test.ts` and `hooks/__tests__/useSettingsController.delete.test.tsx` cover it.
