# Apple app (iPhone, iPad, Mac)

The native Teak app on iPhone, iPad and Mac shows the library in a grid with search chips, a "More" menu (select, Revisit, show, sort), archive, folders and smart folders, tags, Revisit, and a card view with a done toggle for links, link pills, "Linked from", prices, publish dates, photo details and the "From" source. The share extension saves first and then takes tags and a note. Every change reaches the same backend as the web app, so a change made here shows on the web and back.

## Sub-features

- `apple-archive` archives and unarchives a card from its context menu, swipe, Card menu or More menu, with Undo; the Archive view lists them (sidebar on Mac and iPad, More menu on iPhone).
- `apple-bulk` selects cards (More › Select) and archives, unarchives, adds tags, adds to a folder, favorites, moves to Trash or restores them, with a count message and Undo.
- `apple-sort` sorts by Newest First, Oldest First or Shuffle from the More menu, with Reshuffle for a new order.
- `apple-folders` lists folders and smart folders (sidebar on Mac and iPad, the **Folders** tab on iPhone), opens one, creates, renames and deletes with Undo, files a card from its Folders row or the selection bar, and saves the current search as a smart folder.
- `apple-done` toggles "Mark as read/watched/bought…" or "Mark as done" on a link, shows a check on done tiles, and finds them with `is:done` and `is:todo`.
- `apple-search` turns typed `is:archived`, `is:done`, `is:todo`, `price:<n>`, `text:"…"`, `mood:…`, `#tag` and quoted phrases into chips, searches by meaning, and shows "Shows hidden cards" for a `#secret` or `#hidden` search.
- `apple-more-like-this` opens the library with a "Similar to" chip from a card's More menu or context menu.
- `apple-refresh` runs Refresh Details and shows the queued message, or the refusal ("This card is already refreshing…").
- `apple-hidden` shows "Hidden. Search #secret to see it." in Edit when a hidden tag is added.
- `apple-revisit` deals up to 20 shuffled cards from the current view; Archive (swipe left, ←) and Keep (swipe right, →), Undo (Z), and "All caught up" at the end.
- `apple-card-links` shows `[[…]]` links as pills with live titles or "Missing card", opens the target on tap, and lists "Linked from".
- `apple-card-details` shows Price, Published, EXIF rows (Camera, Taken, Exposure, Aperture, Focal length, ISO) and the "From <host>" footer.
- `apple-tags` lists tags with counts (Mac and iPad sidebar, iPhone Settings › Tags) and renames, merges and deletes them with progress.
- `apple-share-details` adds tags and a note after a single shared item is saved.
- `apple-commands` offers Card menu commands on Mac and iPad: Archive ⌃⌘A, Mark as done ⇧⌘D, More Like This ⇧⌘L, Refresh Details ⌥⌘R, and View › Revisit ⌃⌘R.

## How to get to it (user POV)

- iPhone: Home → the circled-ellipsis **More** button (Select, Revisit, Show, Sort, Save as Smart Folder…); the **Folders** tab (folders and smart folders, New Folder, tap one to open it); Settings › Tags.
- iPad and Mac: the sidebar (Home, Add, Favorites, Archive, Tags, Trash, Settings, then Folders and Types); the **More** button in the library toolbar; on Mac, **+** for adding and Settings opens its own window (⌘, too).
- Any card: press and hold or right-click a tile; open it for the toolbar's done toggle and **More** menu (Archive, Folders…, More Like This, Refresh Details).
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
- **Bulk.** More › **Select**, tap two tiles ("2 Selected"), tap the folder button in the bar, pick "Design refs": "Added 2 cards to Design refs". The bar's heart adds them to favorites ("Added 2 cards to favorites"), or removes them when all are favorites already; the trash button moves them to Trash.
- **Sort.** More › **Shuffle**: the order changes and **Reshuffle** appears; **Newest First** restores it.
- **Folders.** iPhone **Folders** tab (iPad and Mac sidebar) → "Design refs" pushes a page titled "Design refs" with its 12 cards and its own More menu; a card opened there stays in the Folders tab; "Design links" is a smart folder (`tag:design type:link`). Search `type:link is:fav` → More › **Save as Smart Folder…** → "Saved “…”". Press and hold a folder → **Rename…** / **Delete** (Undo restores it).
- **Done.** Search `#scenario-done-states`; done links show a green check. Open "A tv link" → tap **Mark as watched**: "Marked as watched", the toggle reads "Watched"; tap again to undo. Type `is:todo` + Return: only actionable links that aren't done.
- **Search.** Type `is:todo price:<100 text:"Total due" mood:calm` + Return: four chips ("To do", "Price: Under 100", "Text in image: Total due", "Mood: “calm”"). `#secret` + Return: the "Shows hidden cards" header and the hidden cards.
- **More like this.** Open a card → **More** → **More Like This**: Home with a "Similar to: <title>" chip.
- **Refresh.** Open a card → **More** → **Refresh Details**: "Refreshing details. The summary and tags update shortly." Again at once: "This card is already refreshing. Try again in a minute."
- **Hidden hint.** Open a note → pencil → add tag `Secret`: "Hidden. Search #secret to see it." under Tags. Cancel → Discard Changes.
- **Revisit.** More › **Revisit**: "1 of 20" with a card, its type and "Saved <date>". Swipe right (Keep) → "2 of 20"; swipe left (Archive) → "3 of 20" and **Undo**; Undo → "2 of 20". On a view with fewer cards (`#rv1`) the deck ends with "All caught up" and "<n> archived · <n> kept". Revisit is greyed out in Archive and Trash.
- **Card links.** Search `#scenario-backlinks hub`, open "Source 60": the pill "Hub with 60 backlinks"; tap it → the hub opens with **Linked from** rows. Search `"Broken links"` and open it: three "Missing card" pills, "Renamed after linking" live title, RTL, CJK and emoji titles.
- **Card details.** Search `#scenario-save-details`, open "A selection from a page whose title runs to 300 characters.": "From example.org" and the page title at the bottom. Product links show **Price**, dated links **Published**, uploaded photos with EXIF the camera rows.
- **Tags.** iPhone Settings › Tags (iPad and Mac sidebar Tags): every tag with counts, hidden tags with an eye-slash. Press and hold "design" → **Rename…** to "design-systems": the progress row, then "Renamed “design” to “design-systems”. 38 cards changed." Rename it back so seeded smart folders keep matching.
- **Share.** Share a single link or text to Teak: "Saved", then **Add tags** and **Add a note** fields and **Done**/**Save**; it closes on its own after 3 seconds if untouched.
- **UI tests.** `TEAK_IPHONE="<iPhone>" apps/apple/scripts/ui-tests.sh ios -only-testing:TeakUITests/LibraryFlowTests` (also `ipad`; `mac` needs UI automation allowed).

## Gotchas

- Renaming a seeded tag empties the smart folders that name it ("Design links", "🎨 Moodboard ✨"); rename it back.
- The status toast with **Undo** stays about 6 seconds; tap Undo in that window.
- On iPad and iPhone an active search hides the library toolbar, so open More before typing a search.
- Debug builds read the stack's URLs and session only from launch environment variables; a plain relaunch from the home screen keeps the last session.
- The Mac Debug app shares the bundle id with an installed Teak; don't write its defaults, pass `-teak.appearance` instead.
- `archive-mix` seeds 200 cards per page, so a fresh account reaches the Free card limit; saving new cards then needs Pro or fewer seeds.
