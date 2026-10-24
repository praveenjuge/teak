# Find

A user finds cards again by typing in the search box, narrowing with qualifiers that become removable chips, filtering by type or sort in the View menu, or browsing Favorites, Archive, Trash, Tags and folders. The command palette jumps to views, folders, cards and commands.

## Sub-features

- `find-search` filters the grid live as you type, keeping the query in `?q=` (at most 500 characters: the box stops taking more, and the URL never cuts what you typed).
- `find-slash` focuses the search box with `/`, and on Tags the "Find a tag" box.
- `find-qualifiers` turns `tag:`, `type:`, `is:`, `site:`, `folder:` and quoted phrases into chips, through the "Search suggestions" list or Enter.
- `find-enter` turns a plain word into a keyword chip on Enter; color, style and time words become their own filters, kept in the URL (`?color=blue,ff5733&style=minimal&date=This+Week`) through a reload and Back; `fav`, `trash` and `archive` navigate.
- `find-clear` clears with "Clear all", a chip's remove button, Backspace (the chip just left of the cursor, the last one shown), or "Clear filters".
- `find-view` uses the View menu: card types (a `type:` qualifier becomes a checked type, and checking another adds to it), sort (Newest, Oldest, Shuffle, Revisit) and "Save as smart folder…". A search keeps "Newest first" picked over "Best match" through a reload (`&sort=newest`). In Revisit, Space on a focused button presses that button; on the deck it opens details.
- `find-saved-order` orders "Newest first" and "Oldest first" by when a card was last saved, and time words such as "yesterday" find it by that date too, in the library, Favorites, Archive, Trash, folders, tags, sites and search: a card first saved last year and saved again yesterday leads Newest first.
- `find-nav` covers the sidebar views (Favorites, Archive, Trash), Tags, folders and smart folders.
- `find-palette` covers the command palette.
- `find-empty` shows "Nothing found matching your filters" and each view's empty state.

## How to get to it (user POV)

- The combobox in every view's header: "Search everything", "Search favorites", "Search archive", "Search Trash", or "Search <folder>".
- Press `/`. Press Ctrl+K (⌘K) for the palette.
- Sidebar links "Everything", "Favorites", "Tags", "Archive", "Trash", and folder links by folder name.
- Key sequences `g e`, `g f`, `g a`, `g t`.

## Driving it with e2e MCP

Preconditions:

- Signed in, with a card holding this run's marker (make one with [capture](./capture.md) or the API).
- Search by a marker that isn't a color, style, time or command word.

Steps:

- **Search.** `press` "/" (focus outside a field). The combobox is focused. `type` the marker. The URL gains `?q=` and the marked cards are listed. On the dev deployment related seeded cards can also appear by meaning; judge the step by the marked cards, not by an empty remainder.
- **No match.** `type` "tag:zzzz-no-match-<run-id>" with `replace: true`. The text "Nothing found matching your filters" and a button "Clear filters" appear. Use a `tag:` qualifier: a plain nonsense word still matches cards by meaning on the dev deployment (see Gotchas).
- **Clear.** `tap` button "Clear all" (the X in the field). The query empties and the full grid returns.
- **Keyword chip.** `type` the marker and `press` "Enter". The input empties and a chip button "Remove <marker>" appears (lowercased). Proof that it persists: `navigate` to the current URL; the chip is still there.
- **Qualifier.** `type` "type:quote" and `press` "Enter". The chip "Remove type Quote" appears and only "Quote:" cards remain. `tap` the chip to remove it.
- **Backspace.** From `/?tag=design`, `type` the marker and `press` "Enter": chips "Remove tag filter design" then "Remove <marker>". `press` "Backspace" in the empty box: only "Remove <marker>" goes; the tag chip stays.
- **Type qualifier and View.** `navigate` to `/`, `type` "type:quote", `press` "Enter". The URL becomes `/?type=quote`, the chip is "Remove type Quote", and the View menu has "Quote" checked. Check "Palette": the URL becomes `/?type=quote,palette` and quotes and palettes are both listed (not "Nothing found").
- **Colors and dates in the URL.** `navigate` to `/`, `type` "blue" and `press` "Enter", then `type` "this week" and `press` "Enter". The URL becomes `/?color=blue&date=This+Week` with chips "Remove This Week" and "Remove Blue". `navigate` to that URL again: both chips are still there. `tap` "Remove Blue", then go `back`: "Remove Blue" is back.
- **Suggestions.** `type` "ty". Listbox "Search suggestions" opens with options such as "type:". `press` "Escape" to close only the list.
- **View menu.** `tap` the button whose name starts "View". The menu has checkboxes "Text" … "Quote", "Show all types", radios "Newest first", "Oldest first", "Shuffle", "Revisit", and "Save as smart folder…". `tap` "Image": the URL gains `?type=image`, the chip "Remove type Image" appears and the button becomes "View: Image". `press` "Escape", then remove the chip.
- **Search sort survives a reload.** `navigate` to `/?q=design`; the View menu has "Best match" checked. Pick "Newest first": the URL becomes `/?q=design&sort=newest`. `navigate` to that URL again and open the View menu: "Newest first" is still checked.
- **Saved order.** Seed the `ordering-saved` pack from `packages/convex`: `bunx convex run devSeed:seedScenario '{"workosUserId":"<id>","scenario":"ordering-saved"}'`, with the id from `.agents/.state/dev-account.json` (it needs this checkout's backend pushed). `navigate` to `/?tag=scenario-ordering-saved`: the cards read "Resaved: first saved 400 days ago, saved again yesterday", "Two days…", "Last month…", "Two years…". Pick "Oldest first" in the View menu: "Two years…" comes first and "Resaved…" last. Back on "Newest first", `type` "yesterday" and `press` "Enter": only "Resaved…" remains, though it was first saved 400 days ago. (Avoid "last week": "Two days…" falls in it only early in the week.) The folder "Saved again", `site:ordering-saved.example.com`, Favorites (with the tag) and Archive ("Archived: … saved again 3 days ago" before "Archived: saved 10 days ago…") keep the same order, and so does Trash. Screenshot each to `$E/saved-order-*.png`, then permanently delete the pack's cards and the folder.
- **Revisit keys.** From the View menu pick "Revisit": dialog "Revisit" with "1 of N". `press` "Space" on button "Keep": the counter reads "2 of N", "Keep" keeps focus and no card dialog opens. Keep, not Archive, so the run changes no card.
- **Views.** `tap` link "Favorites". Heading "Favorites", combobox "Search favorites", and the seeded favorites (including the "Welcome to Teak…" card) are listed. Do the same for "Archive" (empty state "Nothing archived. Archive a card to keep it out of your library.") and "Trash", which the seeded vault starts with one card in: "Text: Old draft I meant to throw away."
- **Tags.** `tap` link "Tags". Searchbox "Find a tag" and links named "<tag>, N cards" are listed. `press` "/": "Find a tag" is focused. `tap` a tag: the URL becomes `/?tag=<tag>` with the chip "Remove tag filter <tag>", even when a search was open on Everything before. Go `back` once: it lands on `/tags`.
- **Folder.** `tap` link "Start here". The URL becomes `/f/<id>` and the combobox reads "Search Start here".
- **Smart folder.** `tap` link "Moodboard", a sibling of "Start here" in the sidebar. The URL becomes `/f/<id>`, its saved query (`type:image type:palette`) shows as locked chips with an "Edit search" button, and only image and palette cards are listed.
- **Transcript.** `type` "crowded", a word only the seeded voice memo's transcript holds. Only "Audio: Brand refresh voice memo.m4a" is listed. `tap` it: dialog "Brand refresh voice memo.m4a" shows "Transcript" with "Quick note for the studio brand refresh…". Proof: `navigate` to `/?card=<id>`; the transcript is still there.
- **Palette.** `press` "Control+k". Dialog "Command palette" with combobox "Search commands, folders and cards". `type` the marker: a "Cards" group lists the card. `press` "Enter": the card's dialog opens and the URL gains `?card=<id>`.

## Gotchas

- Enter changes the query: a plain word becomes a chip and the input empties. "orange" becomes a color filter, "minimal" a style, "today" a time; "fav", "trash" and "archive" navigate.
- The dev deployment also searches by meaning, so even a nonsense word can show cards: "zzzz-no-match-…" matched the seeded "Document: Teak search cheat sheet.pdf". For a no-match check use a qualifier (`tag:zzzz-no-match-<run-id>`), which matches exactly. Empty results wait up to 1.5 s before the empty state.
- A card made through the API reaches server search after a short delay. If the UI misses it, search again after a few seconds before calling it a bug.
- Processing can rename a card ("Text: …" to "Palette: …", or a link's title), so match by marker, not by full name.
- Home and search results stay mounted, hidden, behind folder pages, so text can appear twice in the DOM. Trust what `observe` lists as visible.
- Cards tagged "secret" or "hidden" appear only when the search names the tag (`#hidden`, `tag:secret`).
- At phone width, the search field hides behind a "Search" button.
