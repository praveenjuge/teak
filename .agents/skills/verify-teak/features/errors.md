# Errors and resilience

When a read or save fails or the connection drops, Teak says what happened where it happened and keeps what the person made: errors stay inside the app, an unsaved recording stays in its dialog, images retry with a fresh link, and failed deletes, sign-outs and going offline are reported.

## Sub-features

- `errors-page` shows "Something went wrong. Please try again." with "Try again" (which reloads) in place of a page that fails to render; the sidebar (or on phones its toggle) stays, and Settings pages show it under the Settings header.
- `errors-sidebar-folders` shows "Couldn't load your folders." with "Try again" in the sidebar's Folders group; the views above keep working (nothing in the collapsed rail).
- `errors-tags-summary` stops Tags' loading skeleton after two failed tag-summary attempts and shows "Couldn't load your tags." with "Try again" (asks once more, no reload). An attempt fails when its request fails or after 45 seconds without a summary; the second starts 5 seconds later, so a request that never answers shows the message after about 95 s. A later summary replaces it.
- `errors-recording-save` keeps an audio recording until saved: "Stop and Save" keeps the dialog open as "Saving recording…" with "Download" (`recording_<time>.webm` or `.m4a`) throughout; closing it doesn't stop the save. If the save fails, the "Recording audio" dialog (re)opens saying "Couldn't save the recording. Try again, or download it to keep it." (or the card-limit or rate-limit reason) with "Discard", "Download" and "Try again" (no reload).
- `errors-media-refresh` asks once for a fresh link when media fails: link tiles then fall back to their screenshot; the dialog's image, video, GIF and audio retry before saying they're unavailable.
- `errors-bulk-delete-forever` keeps cards a bulk "Delete forever" couldn't delete selected ("1 card selected").
- `errors-sign-out` shows "Failed to sign out. Please try again." when signing out fails from the command palette, the blocked-account screen or Settings.
- `errors-offline` shows "You're offline. Changes will save when you reconnect." while offline; a note saved meanwhile reads "You're offline. This note will save when you reconnect." until it saves.
- `errors-delete-account` never reports a failed deletion once it went through (a failed sign-out after it lands on sign-in), and reopening "Delete account" clears the last error.
- `errors-theme-toggle` (the palette's "Toggle theme") flips light and dark, and flipping back to the system's own returns to "System".

## How to get to it (user POV)

- Any library page, `/tags`, Settings and the sidebar's Folders group, when a read fails.
- "New" → "Record audio" (`R`) → "Stop and Save".
- Link tiles; an image, video or audio card's dialog.
- `/trash`: select, "Delete forever".
- Palette (Ctrl+K): "Sign out", "Toggle theme".
- Any page offline; the composer.
- Settings → Account → "Delete account".

## Driving it with Playwright

`scripts/convex-faults.cjs` makes named Convex functions fail on one page's sync socket; `page.route` fails images. Sign in first (save `storageState`), then per check:

- **Page.** `injectFaults(page, { failQuery: (n) => n === "listTagSummary" })`, open `/tags`: alert "Something went wrong. Please try again." with "Try again"; link "Everything" still visible.
- **Folders.** `failQuery: (n) => n === "listFolders"`, open `/`: alert "Couldn't load your folders." in the sidebar; "Everything" still visible.
- **Tags summary.** `rewriteQuery: (n) => (n === "listTagSummary" ? null : undefined)` and `failRequest: (n) => n === "requestTagSummary"`, open `/tags`, wait 9 s: no list "Loading tags"; alert "Couldn't load your tags." with "Try again".
- **Recording.** Chromium with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream` and microphone permission; `failRequest: (n) => n === "uploadAndCreateCard"`. `r`, wait 2 s, "Stop and Save": dialog "Recording audio" shows the failure and its three buttons. "Download" downloads; "Discard" closes; nothing is saved.
- **Link image.** Route the seeded "Tomato soup" preview image (URL contains `link-preview-image%2F`) to 404 and `failRequest: (n) => n === "refreshCardMediaUrl"`; search `tomato`: the tile shows its screenshot, no page error.
- **Dialog image.** Answer the "Coral lily" card's first `/detail/` image request with 403, pass the `teak_retry` one; open `/?card=<id>`: the image loads from the `teak_retry` URL.
- **Bulk delete forever.** Create two marked notes via the API and trash them; `failRequest: (n, m) => n === "permanentDeleteCard" && JSON.stringify(m.args).includes(<first id>)`; in `/trash?q=<marker>` select both (`x`), Delete, "Delete forever": "1 card selected", the first card pressed. Delete both for good via the API.
- **Sign out.** `page.route` `abort()`s POSTs with a `next-action` header; palette → "Sign out": the sign-out toast, still on `/`.
- **Offline.** `context.setOffline(true)`: the offline toast; save a marked note: the note's offline message; `setOffline(false)`: "Saved". Delete it for good.
- **Theme toggle.** `colorScheme: "light"`, theme on System: "Toggle theme" twice; `localStorage.theme` goes `dark`, then `system`.

## Gotchas

- Inject faults before the page's first navigation: the helper wraps the socket as it opens.
- Playwright's WebKit, unlike Safari, allows clipboard writes after an await, so it can't catch image-copy bugs; `hooks/__tests__/useCardClipboard.test.ts` checks the write starts within the click.
- "Try again" on the page and folders errors reloads the page, since the query cache would return the same error to a plain retry; Tags' and the recording's retry in place.
- The sign-out check really signs out if the route misses the request; sign in again, save new `storageState`.
- Account deletion can't be driven on the shared dev account; `lib/__tests__/accountDeletion.test.ts` and `hooks/__tests__/useSettingsController.delete.test.tsx` cover it.
