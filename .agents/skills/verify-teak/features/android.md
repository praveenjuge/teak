# Android app

The native Android app (`Teak Dev` in Debug) shows the same vault as the web: a Home grid with search, filter chips (Favorites, Archive, Trash, Done, To do, types, color), a sort menu, folders and smart folders, card details, Revisit, a Tags manager, and a share sheet that saves links, text and files. A Debug build can sign in to the local E2E stack as a fresh emulator account, so every recipe here runs without a real WorkOS login.

## Sub-features

- `android-sign-in` signs the Debug build in to the local E2E stack with `apps/android/scripts/e2e-session.ts`.
- `android-sort` sorts Home by "Newest first", "Oldest first" or "Shuffle" (each Shuffle reshuffles).
- `android-archive` shows the Archive view, archives or unarchives from a tile's long-press menu, the detail overflow, the E key or the selection bar, with "Undo".
- `android-bulk` acts on selected cards: Archive or Unarchive, Add to favorites, Remove from favorites, Add tags…, Add to folder…, Move to Trash, Restore, Delete forever.
- `android-folders` lists folders and smart folders in the Folders tab, opens one, creates, renames, edits a smart folder's search, deletes with "Undo", and saves a search as a smart folder.
- `android-done` marks a link done from the detail top bar with the verb for its category, as on the web ("Mark as read" for a book, article or research link, "Mark as watched" for a film, "Mark as done" when the category is unknown), shows the check on tiles, and filters with the Done and To do chips (`is:done`, `is:todo`).
- `android-search` shows typed filters as chips ("Show Archived", "Price Under 50", "Text in image …", "Mood “…”", "Similar to …"), ranks free words and `like:`/`mood:` searches by meaning, and "More like this" from a tile or the detail overflow.
- `android-detail` shows "Refresh details", "Folders…", the "From example.com" row on text saved from a page, "Published", "Price" on product links, and camera rows (Camera, Taken, Exposure, Aperture, Focal length, ISO) on photos.
- `android-card-links` shows `[[` links as pills with live titles or "Missing card", and a "Linked from" section; Edit keeps the raw token.
- `android-hidden` shows "Hidden. Search #secret to see it." after adding a hidden tag in Edit, "Shows hidden cards" when searching one, and "Some cards are hidden…" on an empty view.
- `android-revisit` deals up to 20 shuffled cards from the current view: swipe or ← to archive, → to keep, Z to undo, and "All caught up" at the end.
- `android-tags` lists tags in Settings → Tags and renames, merges or deletes one, with progress.
- `android-share` saves a shared link or text, then offers "Add tags and a note"; left alone the sheet closes itself.
- `android-search-operators` sends `-`, `OR`, parentheses and `site:` as typed (no chips for a search with operators), lists suggestions under the search field ("Exclude" with `-tag:` … `-is:`, "Combine" with "OR · Either side matches", "Filters", "Types", "Show"), and searches the words beside a date ("figma last week" sends the date range and "figma"). See [search-operators](./search-operators.md).

## How to get to it (user POV)

- Home tab: the search field, the filter chips under it, and the top bar's Revisit, Sort and Select buttons. Long-press a tile for Select, Archive or Unarchive, and More like this.
- Folders tab: the "New folder" button (New folder, New smart folder) and each row's "More for <name>" menu. Home's Sort menu has "Save as smart folder…" while searching.
- A card: the top bar's done button on links; the floating toolbar's "More" menu (Archive, More like this, Folders…, Refresh details, Move to Trash); Edit.
- Settings → Library → Tags.
- Any app's Share → Teak Dev.
- Hardware keyboard on an open card: E archive, D done, R refresh details, F favorite. In Revisit: ← or A archive, → or K keep, Space open, Z undo, Esc close.

## Driving it with adb and the Debug build

Preconditions:

- JDK 17+ (`JAVA_HOME=/opt/homebrew/opt/openjdk@21` on a Mac), the Android SDK in `apps/android/local.properties`, and an emulator booted with `-gpu host` (software rendering is too slow to drive). Turn off stylus handwriting so typing lands: `adb shell settings put secure stylus_handwriting_enabled 0`.
- The E2E stack is up: `.agents/.state/stack.json` shows `mode: "e2e"` and `ready: true`.
- Install and sign in: from `apps/android`, `./gradlew :app:installDebug`; then from the repo root `bun --no-env-file run apps/android/scripts/e2e-session.ts`. It reverses the stack's ports onto the device, hands the app a fresh `e2e-android-…@example.org` account, restarts it, and prints that account's `workosUserId`. Run it again after an emulator restart only if the app shows the Welcome screen; port reverses must be redone after every restart (`adb reverse tcp:<port> tcp:<port>` for the stack's convex, convexSite, emulator, filesWorker and web ports).
- Seed from `packages/convex`: `env -u CONVEX_DEPLOY_KEY CONVEX_AGENT_MODE=anonymous bunx convex run devSeed:seed '{"workosUserId":"<id>"}'`, then `devSeed:seedScenario` with `archive-mix`, `smart-folders`, `done-states`, `hidden-mix`, `card-links`, `card-details`, `rich-sites`, `revisit-sizes`, `search-qualifiers`, `save-details` and `omnibox-titles`. Those packs put the account over the Free plan's 200 cards, so use a second account with only `devSeed:seed` for anything that creates cards (share, uploads).
- Find and tap controls by text or content description from `adb shell uiautomator dump`; type with `adb shell input text` (`%s` for spaces); capture with `adb exec-out screencap -p`. Dark theme: `adb shell cmd uimode night yes`.

Steps:

- **Sort.** Tap "Sort" → "Oldest first": old `rv…` notes come first and the button reads "Sort: oldest first". Pick "Shuffle" twice: the order changes each time. Pick "Newest first" to finish.
- **Archive.** Tap the "Archive" chip: the title is "Archive". Long-press "Archived design note" → "Unarchive": it leaves with "Returned 1 card to the library" and "Undo"; tap "Undo" (it stays 10 seconds): the card is back.
- **Bulk.** Search "Mix", tap "Select cards", pick two tiles, tap "More actions" → "Add tags…" → type `verify-<run-id>` → "Add tags": "Added tags to 2 cards". `tag:verify-<run-id>` shows a "Tag …" chip and only those cards. "Add to folder…" → type a new name → "Create folder “…”": "Added 2 cards to …".
- **Folders.** Folders tab: smart folders show their search under the name; open "Design links": only links tagged design. "More for <yours>" → "Rename…" → Save. "Delete" → "Deleted “…”. Its cards are still in your library." → "Undo" brings it back. Delete it again to clean up.
- **Done.** Search `is:todo`, open "A book with an ISBN-13" → "Mark as read": the button reads "Read", "Marked as read" with "Undo". Back in the grid it's gone from `is:todo`; `is:done ISBN` shows it with the check and the Done chip on. Press D on the card (or tap "Read") to put it back.
- **Refresh details.** On any card: More → "Refresh details" → "Refreshing details. The summary and tags update shortly."; press R right after → "This card is already refreshing. Try again in a minute."
- **More like this.** More → "More like this": Home shows the chip "Similar to <title>". The local backend's log (`bunx convex logs --history 400 --success`) shows `search/semanticActions:requestSemanticResults` for free-word and `like:` searches, and none for a filter-only search like `is:archived`.
- **Card links.** `tag:scenario-card-links` → "Cycle A → Cycle B": a pill with B's current title and "Linked from" listing Cycle C. "Broken links": three "Missing card" pills and "Renamed after linking". Edit shows the raw `[[…|teak:…]]` text; Close without saving.
- **Detail rows.** `tag:scenario-omnibox-titles` → "Omnibox note: 1 < 2 > 0, saved from a page": Info "From · example.com". `tag:scenario-card-details` → "Author, a distinct publisher and a date": "Published · Nov 20, 2023". For camera rows, upload a JPEG with EXIF through Add → "Photos & Videos" on the second account: Camera, Taken, Exposure, Aperture, Focal length and ISO appear once processing finishes.
- **Hidden.** `tag:secret`: header "Shows hidden cards"; a hidden card's Tags read "Hidden. Only a search for #secret or #hidden shows this card.". Edit a visible note → add tag "Secret" → "Hidden. Search #secret to see it." → Close → "Discard".
- **Revisit.** Clear the search, tap "Revisit": "1 of 20". Swipe right (keep), press ← (archive: "Archived 1 card" with "Undo"), press Z (back one, card unarchived), press → until "All caught up" with "N archived · N kept", then "Done".
- **Tags.** Settings → Tags → "Find a tag" → your run's tag → "More for …" → "Rename…" (card "Renamed “…” to “…” · N cards changed"), "Merge into…" (pick a tag → "Merge into “…”"), "Delete…" → "Delete tag" ("Deleted “…”"; "No tags match …"). Deleting the run's tags is also the cleanup for **Bulk**.
- **Search operators.** Seed `search-operators` and search the rows of [search-operators](./search-operators.md)'s table (each after `#scenario-search-operators`, in parentheses): the counts match the web's, and no filter chips show. Type `design -`: under the field, "Exclude" lists `-tag:` "Leave out cards with a tag" … `-is:`; tap `-tag:` and the field reads `design -tag:`. Type `design o`: "Combine" with "OR" "Either side matches"; tap it and the field reads `design OR `. `#scenario-search-operators figma last week` lists only cards saved last week that match "figma".
- **Share.** On the second account: `adb shell am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT "https://example.com/verify-<run-id>" -n com.praveenjuge.teak.debug/com.praveenjuge.teak.feature.capture.share.ShareActivity` → "Saved" with "Add tags and a note"; tap it within 6 seconds, add tags and a note, "Save": the sheet closes and the card's detail shows both. Shared again without tapping, the sheet closes on its own.

## Gotchas

- Sign-in for tests exists only in Debug builds; Release ignores the launch file and has no cleartext exception.
- `uiautomator dump` takes a couple of seconds and hangs while a loading animation runs; tap Undo by position when timing matters.
- Sharing a MediaStore image from `adb shell am start` fails with "Teak couldn't read it", because the shell can't grant access to that URI; upload photos through Add → "Photos & Videos".
- No seed pack sets a link price, so the "Price" row and the tile's price pill need a real product page; on the local stack that page has to be reachable from the Files Worker.
- An emulator restart keeps the app and its session but drops `adb reverse`; the app then shows no cards until the ports are reversed again.
