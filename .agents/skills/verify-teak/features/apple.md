# Apple app (iPhone, iPad, Mac)

The native Teak app on iPhone, iPad and Mac shows the library in a grid with search chips, a "More" menu (select, Revisit, show, sort), archive, folders and smart folders, tags, Revisit, and a card view with a done toggle for links, link pills, "Linked from", prices, publish dates, photo details and the "From" source. The share extension saves first and then takes tags and a note. Every change reaches the same backend as the web app, so a change made here shows on the web and back.

## Sub-features

- `apple-archive` archives and unarchives a card from its context menu, swipe, Card menu or More menu, with Undo; the Archive view lists them (sidebar on Mac and iPad, More menu on iPhone).
- `apple-note-tables` shows a note's GFM tables read-only with a bold header row, scrolling a wide one sideways, with `[[` pills working in cells; aligned, ragged and listed tables stay literal monospaced text. Steps in [note-tables](./note-tables.md), **Native apps**.
- `apple-tasks` shows `- [ ]` and `- [x]` items in an open note as checkboxes (done ones muted and struck through); a tap ticks that one item, moves it below the open ones as the web does, and saves the note, and the web shows it live. A failed save puts it back with "Couldn't update the checklist. Try again." Steps in [note-tables](./note-tables.md), **Native apps**.
- `apple-bulk` selects cards (More › Select) and archives, unarchives, adds tags, adds to a folder, favorites, moves to Trash or restores them, with a count message and Undo.
- `apple-sort` sorts by Newest first, Oldest first or Shuffle from the More menu, with Reshuffle for a new order.
- `apple-folders` lists folders and smart folders (sidebar on Mac and iPad, the **Folders** tab on iPhone), opens one, creates, renames and deletes with Undo, files a card from its Folders row or the selection bar, and saves the current search as a smart folder.
- `apple-done` toggles "Mark as read/watched/bought…" or "Mark as done" on a link, shows a check on done tiles, and finds them with `is:done` and `is:todo`.
- `apple-search` turns the filters with a search argument of their own (a type, favorites, `is:archived`, Trash, a color, a style, a date) into chips on Return and keeps the other words in one word chip as typed; picked suggestions (`is:todo`, `type:image`) become chips; it searches by meaning, and shows "Shows hidden cards" for a `#secret` or `#hidden` search.
- `apple-more-like-this` opens the library with a "Similar to" chip from a card's More menu or context menu.
- `apple-refresh` runs Refresh details and shows the queued message, or the refusal ("This card is already refreshing…").
- `apple-hidden` shows "Hidden. Search #secret to see it." in Edit when a hidden tag is added.
- `apple-revisit` deals up to 20 shuffled cards from the current view; Archive (swipe left, ←) and Keep (swipe right, →), Undo (Z), and "All caught up" at the end.
- `apple-card-links` shows `[[…]]` links as pills with live titles or "Missing card", opens the target on tap, and lists "Linked from".
- `apple-card-details` shows Price, Published, EXIF rows (Camera, Taken, Exposure, Aperture, Focal length, ISO) and the "From <host>" footer.
- `apple-tags` lists tags with counts (Mac and iPad sidebar, iPhone Settings › Tags) and renames, merges and deletes them with progress.
- `apple-share-details` adds tags and a note after a single shared item is saved.
- `apple-safari-save` saves the Safari tab with `createCard` and no duplicate check first: a page already in Teak moves to the top (and out of Archive) and the popup reads "Saved to Teak", since `createCard` returns only the id.
- `apple-commands` offers Card menu commands on Mac and iPad: Archive ⌃⌘A, Mark as Done ⇧⌘D, More Like This ⇧⌘L, Refresh Details ⌥⌘R, and View › Revisit ⌃⌘R.
- `apple-card-link-picker` opens a "Link a card" list under a note's Edit field when `[[` is typed, searches as you type (`cards:searchCardLinkSuggestions`, as the web's menu: no Trash, not the note itself), and puts in `[[Title|teak:<id>]]` on a tap or ↑/↓ and Return; Escape or deleting the `[[` closes it.
- `apple-search-operators` sends `-`, `OR`, parentheses and `site:` as typed (one word chip on Return), suggests "-tag: · Leave out cards with a tag"… after a `-` and "OR · Either side matches" after a word, and searches the words beside a date ("figma last week"). See [search-operators](./search-operators.md).
- `apple-image-viewer` opens a photo from its card at full size: on iPhone and iPad full screen over black, with pinch and double-tap zoom (double-tap again fits it), and a swipe down or the ✕ (Escape on a keyboard) to close it; on Mac its own window titled with the file name, zoomed by pinch, double-click or the toolbar's **Zoom In** ⌘=, **Zoom Out** ⌘- and **Zoom to Fit** ⌘0, and scrolled when zoomed in. Animated GIFs keep playing inline and don't open it.
- `apple-audio-seek` makes a voice memo's waveform a seek bar, as on the web: tap or drag to jump there, playing or paused; the time reads the length before playing, then "0:05 / 0:10". VoiceOver reads "Seek, 0:05 of 0:10", and swiping up or down moves it.

## How to get to it (user POV)

- iPhone: Home → the circled-ellipsis **More** button (Select, Revisit, Show, Sort, Save as smart folder…); the **Folders** tab (folders and smart folders, New folder, tap one to open it); Settings › Tags.
- iPad and Mac: the sidebar (Home, Add, Favorites, Archive, Tags, Trash, Settings, then Folders and Types); the **More** button in the library toolbar; on Mac, **+** for adding and Settings opens its own window (⌘, too).
- Any card: press and hold or right-click a tile; open it for the toolbar's done toggle and **More** menu (Archive, Folders…, More like this, Refresh details).
- Share sheet from any app → Teak → "Saved" → tags and note → Save.

## Driving it with the iOS Simulator and xcodebuild

Preconditions:

- The local E2E stack is up (`.agents/.state/stack.json` shows `mode: "e2e"` and `ready: true`).
- `bun --no-env-file run apps/apple/scripts/e2e-session.ts` prints the launch environment; the user id is in the base64 `TEAK_UI_TEST_SESSION` JSON (`user.id`).
- Build: `xcodebuild build -project apps/apple/Teak.xcodeproj -scheme Teak -destination "platform=iOS Simulator,name=<iPhone>" -derivedDataPath apps/apple/build/DerivedData`, then `xcrun simctl install` and launch with each variable prefixed `SIMCTL_CHILD_`. On Mac, build with `-allowProvisioningUpdates` and `open -n --env K=V … Teak.app --args -teak.appearance light|dark` (the argument doesn't touch saved preferences).
- Launch once so the account is linked, then seed it from `packages/convex`: `env -u CONVEX_DEPLOY_KEY CONVEX_AGENT_MODE=anonymous bunx convex run devSeed:seed '{"workosUserId":"<id>"}'` and `devSeed:seedScenario` with `archive-mix`, `smart-folders`, `done-states`, `hidden-mix`, `card-links`, `backlinks`, `card-details`, `save-details`, `revisit-sizes`, `search-qualifiers`.
- Screenshots: `xcrun simctl io <device> screenshot`; on Mac capture only Teak's window with `screencapture -l <window id>`, never the whole screen.

Steps:

- **Archive.** Press and hold a Home tile → **Archive**: "Archived 1 card" with **Undo**, the tile leaves Home. More › Archive (sidebar Archive on iPad and Mac) lists it; press and hold → **Unarchive**: "Returned 1 card to the library"; **Undo** puts it back in Archive.
- **Bulk.** More › **Select**, tap two tiles ("2 selected"), tap the folder button in the bar, pick "Design refs": "Added 2 cards to Design refs". The bar's heart adds them to favorites ("Added 2 cards to favorites"), or removes them when all are favorites already; the trash button moves them to Trash.
- **Sort.** More › **Shuffle**: the order changes and **Reshuffle** appears; **Newest first** restores it.
- **Folders.** iPhone **Folders** tab (iPad and Mac sidebar) → "Design refs" pushes a page titled "Design refs" with its 12 cards and its own More menu; a card opened there stays in the Folders tab; "Design links" is a smart folder (`tag:design type:link`). Search `type:link is:fav` → More › **Save as smart folder…** → "Saved “…”". Press and hold a folder → **Rename…** / **Delete** (Undo restores it).
- **Done.** Search `#scenario-done-states`; done links show a green check. Open "A tv link" → tap **Mark as watched**: "Marked as watched", the toggle reads "Watched"; tap again to undo. Type `is:todo` + Return: only actionable links that aren't done.
- **Search.** Type `is:to` and pick "To do" from the suggestions: a "To do" chip. Type `type:image price:<100 text:"Total due"` + Return: an "Image" type chip and one word chip `price:<100 text:"Total due"`. `#secret` + Return: the "Shows hidden cards" header and the hidden cards.
- **Search operators.** Seed `search-operators` and search the rows of [search-operators](./search-operators.md)'s table (each after `#scenario-search-operators`, in parentheses): the counts match the web's. Type `design -`: the suggestions list `-tag:` … `-is:` with "Leave out …"; pick "-tag:" and the field reads `design -tag:`. Type `design o`: "OR · Either side matches"; pick it and the field reads `design OR `. `#scenario-search-operators figma last week` lists only cards saved last week that match "figma".
- **More like this.** Open a card → **More** → **More like this**: Home with a "Similar to: <title>" chip.
- **Refresh.** Open a card → **More** → **Refresh details**: "Refreshing details. The summary and tags update shortly." Again at once: "This card is already refreshing. Try again in a minute."
- **Hidden hint.** Open a note → pencil → add tag `Secret`: "Hidden. Search #secret to see it." under Tags. Cancel → Discard changes.
- **Revisit.** More › **Revisit**: "1 of 20" with a card, its type and "Saved <date>". Swipe right (Keep) → "2 of 20"; swipe left (Archive) → "3 of 20" and **Undo**; Undo → "2 of 20". On a view with fewer cards (`#rv1`) the deck ends with "All caught up" and "<n> archived · <n> kept". Revisit is greyed out in Archive and Trash.
- **Card links.** Search `#scenario-backlinks hub`, open "Source 60": the pill "Hub with 60 backlinks"; tap it → the hub opens with **Linked from** rows. Search `"Broken links"` and open it: three "Missing card" pills, "Renamed after linking" live title, RTL, CJK and emoji titles.
- **Card link picker.** Open any note → pencil → in the note field type " [[garden": the "Link a card" list shows "Garden plan" (seeded by `card-links`) and never the note itself. Tap it (Mac: ↓ then Return): the field reads `[[Garden plan|teak:<id>]] ` and the list closes. **Save**: the note shows a "Garden plan" pill, and "Garden plan" lists the note under **Linked from**. Type "[[" then Escape (hardware keyboard): the list closes and stays closed until the `[[` is deleted. `[[trash` offers no card from Trash.
- **Card details.** Search `#scenario-save-details`, open "A selection from a page whose title runs to 300 characters.": "From example.org" and the page title at the bottom. Product links show **Price**, dated links **Published**, uploaded photos with EXIF the camera rows.
- **Tags.** iPhone Settings › Tags (iPad and Mac sidebar Tags): every tag with counts, hidden tags with an eye-slash. Press and hold "design" → **Rename…** to "design-systems": the progress row, then "Renamed “design” to “design-systems”. 38 cards changed." Rename it back so seeded smart folders keep matching.
- **Share.** Share a single link or text to Teak: "Saved", then **Add tags** and **Add a note** fields and **Done**/**Save**; it closes on its own after 3 seconds if untouched.
- **Safari save.** Seed `resave` ([api-cli-mcp](./api-cli-mcp.md), **Re-save**). In Safari on Mac (Debug build, extension on), open `https://example.com/resave/060` (archived in the pack) and click **Teak** in the toolbar: "Saved to Teak". The library lists that card first, out of Archive, and search `resave/060` finds one card. `bun --no-env-file test apps/apple/tests/safari-popup.test.ts` covers the popup's states; the native handler has no automated test.
- **Image viewer.** On a second account with only `devSeed:seed` (seeded images have no stored file), Add → **Photos & videos** (Mac: drop a photo on **+**) a large photo and open its card. iPhone: tap the photo: it fills a black screen; double-tap a corner: it zooms in on that corner; double-tap again: it fits; pinch out to zoom and drag around; at fit, drag down about a third of the screen: the background fades and it closes; open again and tap ✕. Rotate while open: it fits the new width. Mac: click the photo: a window titled with the file name opens beside the main one; ⌘= twice zooms and the scroll bars appear, ⌘0 fits, double-click zooms in, ⌘- steps back. Quit and relaunch: the image window doesn't come back.
- **Audio seek.** On the same account, Add → **Voice memo**, record about 10 seconds, save and open it: the time reads "0:10". Tap the middle of the waveform: "0:05 / 0:10" and half the bars turn red; tap play: it plays from 0:05. Drag along the bar while it plays: the bars follow the finger and playback jumps on release. With VoiceOver on the bar: "Seek, 0:05 of 0:10, adjustable"; swipe up moves it on a second (a tenth of a short memo; 5 seconds in a long one).
- **UI tests.** `TEAK_IPHONE="<iPhone>" apps/apple/scripts/ui-tests.sh ios -only-testing:TeakUITests/LibraryFlowTests` (also `ipad`; `mac` needs UI automation allowed).

## Gotchas

- Renaming a seeded tag empties the smart folders that name it ("Design links", "🎨 Moodboard ✨"); rename it back.
- The status toast with **Undo** stays about 6 seconds; tap Undo in that window.
- On iPad and iPhone an active search hides the library toolbar, so open More before typing a search.
- Debug builds read the stack's URLs and session only from launch environment variables; a plain relaunch from the home screen keeps the last session.
- The Mac Debug app shares the bundle id with an installed Teak; don't write its defaults, pass `-teak.appearance` instead.
- `archive-mix` seeds 200 cards per page, so a fresh account reaches the Free card limit; saving new cards then needs Pro or fewer seeds.
