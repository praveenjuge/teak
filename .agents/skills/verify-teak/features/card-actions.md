# Card actions

A user opens a card into a dialog to edit its notes, tags and folders, favorites it, archives it, moves it to Trash, restores it or deletes it forever. Several cards can be selected at once for bulk actions. Every change shows up in the matching view after a reload.

## Sub-features

- `card-open` opens a card dialog from the grid, a deep link or the palette.
- `card-dialog-layout` keeps the dialog's header to the title, "Favorite", "More actions" and one main action ("Open" for a link, "Download" for a file). "Previous card", "Next card" and "Close" sit outside the card on wide screens and in a bottom bar ("Card actions") on phones. Image and video cards float the header over the media until hovered. "Previous card", "Next card" and "Close" stay at one spot on screen whatever the card's size, and every quick click moves exactly one card.
- `card-details-toggle` hides or shows the "Card details" panel ("Hide details" in the menu, or `i`); the choice is remembered.
- `card-photo-details` lists a photo's camera facts under "More details" in "Card details": Camera, Taken, Exposure, Aperture, Focal length and ISO, never its location. "Taken" is the time the camera's clock showed, the same in every viewer's time zone, followed by the offset ("UTC+5:30") when the photo recorded one. Photos processed before Teak stored the clock time still read "Taken" in the viewer's zone.
- `card-saved-again` shows "Saved again" under "Added" in "Card details" when the card's link was saved again more than a minute after it was first added ("Added" keeps the first date). Both use the same date format and follow the UI language ("Erneut gespeichert" in Deutsch). The re-save's own write doesn't add an "Edited" row.
- `card-notes` adds notes, which save on blur.
- `card-tags` adds and removes tags; "secret" and "hidden" hide the card. Tags Teak added fold under "N suggested tags", where "Keep tag …" keeps one and "Remove Teak tag …" drops it.
- `card-folders` adds the card to a folder.
- `card-favorite` favorites and unfavorites a card from the grid or the dialog.
- `card-archive` archives and unarchives a card.
- `card-trash` moves a card to Trash, with "Undo".
- `card-restore` restores a card from Trash.
- `card-delete-forever` deletes a card from Trash for good.
- `empty-trash` deletes every card in Trash for good from "Empty Trash" at the top of `/trash` (or the command palette's "Empty Trash" there), after a confirmation that states the count. The button is disabled while Trash is empty.
- `edit-link` changes a link card's address from "Edit link…" in its menu (grid right-click or the dialog's "More actions"); the card's preview refreshes from the new address.
- `card-bulk` selects several cards and uses the bulk action bar.

## How to get to it (user POV)

- `tap` a card button ("Text: …", "Link: …", "Quote: …", "Palette: …", "Image: …"), or focus it and press Enter.
- `/?card=<id>` opens the dialog directly.
- Each card's hover buttons ("Favorite", "More actions", "Select"), or `right_click` for the same menu.
- Keys on a focused card: `f` favorite, `e` archive, `t` tags, `x` select, Delete moves to Trash.
- Keys in the open dialog: `o` (or ⌘↵) opens the link or downloads the file, `c` copies the link or text, `d` marks a link done, `i` hides or shows details, `n` notes, `t` tags.
- `/archive` and `/trash` for archived and deleted cards.

## Driving it with e2e MCP

Preconditions:

- Signed in, with a text card holding this run's marker ([capture](./capture.md)), found by searching for the marker ([find](./find.md)).
- Act on marked cards only. If a recipe touches a seeded card, undo it.

Steps:

- **Open.** `tap` "Text: verify-<run-id> …". Dialog "Note" opens and the URL gains `?card=<id>`. The dialog has "Previous card", "Next card", "Favorite", "More actions" and "Close"; a note shows no visible title, only its content. The aside is "Card details".
- **Rapid next.** Note the "Next card" button's center, then click that one point 25 times quickly (`press` "ArrowRight" works too). The dialog stays open, the button never moves, and the URL's `?card=` lands 25 cards on (or on the last card, where "Next card" is disabled). Press `?`: "Keyboard shortcuts" opens over the card, and Escape returns to the card with its keys working.
- **Details toggle.** In "More actions" choose "Hide details" (or press `i`). The aside is hidden; open another card and it stays hidden. Press `n`: the details come back and textbox "Notes" is focused. Undo with `i` if it is hidden.
- **Photo details.** Upload a JPEG named `verify-<run-id>-photo.jpg` whose EXIF has a capture time ([capture](./capture.md)); Pillow can make one: `img = Image.new("RGB", (640, 480))`, `exif = img.getexif()`, set `exif[0x010F] = "Teak Camera Co"` (Make) and `exif[0x0110] = "Verify One"` (Model), then in `ifd = exif.get_ifd(0x8769)` set `ifd[0x9003] = "2026:05:17 14:30:05"` (DateTimeOriginal), `ifd[0x8827] = 400` (ISO) and, for the offset, `ifd[0x9011] = "+05:30"`; save with `img.save(path, "JPEG", exif=exif.tobytes())`. Once processing finishes, open "Image: verify-<run-id>-photo.jpg" and `tap` "More details". Rows "Camera" ("Teak Camera Co Verify One"), "Taken" and "ISO" ("400") appear; "Taken" reads "May 17, 2026, 02:30 PM", with " UTC+5:30" after it when the photo has the offset. Proof: open the card again from a browser in another zone (Playwright `timezoneId: "America/Los_Angeles"` or `"Pacific/Auckland"`, `.agents/cloud.md`): "Taken" stays 02:30 PM while "Added" moves with the zone. A photo processed before the Files Worker stored the clock time (its `fileMetadata.exif` has `takenAt` but no `takenAtClock`) still moves with the zone (07:30 AM in Los Angeles). Delete the card forever in cleanup.
- **Saved again.** Seed `ordering-saved` ([find](./find.md)), search `#scenario-ordering-saved` and open the link "Resaved: first saved 400 days ago, saved again yesterday". "Card details" shows "Added" with the date 400 days ago, then "Saved again" with yesterday's date, and no "Edited". The "Two days" link shows only "Added". To see it from a real save, `POST /v1/cards` with the link of a card added more than a minute ago ([api-cli-mcp](./api-cli-mcp.md), `api-resave`), then open it: "Saved again" reads the time of that save. In Settings → Appearance → Language → Deutsch the row reads "Erneut gespeichert"; switch back to English after.
- **Notes.** `type` "verify-<run-id> note" into textbox "Notes", then `press` "Tab" to blur. The header shows "Saved" for about two seconds, then nothing (a slow save shows "Saving…", a failed one "Couldn't save"). Proof: `navigate` to `/?card=<id>`; the Notes textbox shows the text.
- **Leave right after typing.** Open a marked note, click into its text, type a few characters and, within a second, leave without blurring: `tap` the type button ("Text"), a tag chip, or go Back. Reopen the card: the typed text is there. Type again and reload at once: the browser asks "Leave site?" (`beforeunload`); choosing to stay keeps the edit and it saves.
- **Tags.** `type` "verify-<run-id>-tag" into textbox "Add a tag" and `press` "Enter". The button "Remove tag verify-<run-id>-tag" appears. Proof: reload and it's still there; searching `tag:verify-<run-id>-tag` finds the card.
- **Quick tag edits.** In "Add a tag", type and Enter three tags back to back (`verify-<run-id>-t1`, `-t2`, `-t3`) without waiting: all three chips appear at once and survive a reload. With the box empty, `press` "Backspace" twice quickly: the last two chips go, and after a reload only `-t1` is left. Type `VERIFY-<run-id>-T1` and Enter: nothing is added, the box clears and the toast "Already tagged #verify-<run-id>-t1" appears.
- **Empty note.** Open a marked note, click into its text, select all and delete it, then close with Escape. The toast "Empty notes aren't saved. The note keeps its last text." appears (a quote says "Empty quotes aren't saved. The quote keeps its last text."). Proof: reopen the card; its old text is there, and the grid tile still shows it.
- **Favorite.** In the dialog, `tap` "Favorite". It becomes "Unfavorite" (pressed). Close with "Close" or Escape. Proof: link "Favorites" lists the card. Tap "Unfavorite" to undo.
- **Arrows after the card leaves the view.** Favorite three marked notes, open `/favorites?q=verify-<run-id>`, open the middle one and `tap` "Unfavorite". "Previous card" and "Next card" stay, and `press` "ArrowRight" opens the next note. Unfavorite the three to undo.
- **Favorite twice quickly.** With the dialog focused, `press` "f" twice in a row. The button reads "Unfavorite" after the first press and "Favorite" after the second, and stays "Favorite" while both saves land (it never flips back to "Unfavorite"). Proof: reload; the card isn't a favorite.
- **Archive.** Open the card's "More actions" (in the dialog, or by right-clicking the card) and choose "Archive". The toast "Archived 1 card" offers "Undo", and the card leaves Everything. Proof: `/archive` lists it. There, choose "Unarchive"; the toast "Returned 1 card to the library" appears.
- **Trash.** From the grid's menu, choose "Delete". The toast "Moved 1 card to Trash" offers "Undo". Proof: `/trash` lists the card.
- **Trash from the dialog.** Use a second marked card. Open it, choose "Delete" from the dialog's "More actions": the dialog closes and the toast "Card deleted" offers "Undo". `tap` "Undo"; the card is back in Everything. Delete the card for good in cleanup.
- **Focus after deleting from the dialog.** Open a marked card from the grid (tap it, or Enter on it) and press Delete in its dialog. The dialog closes and focus lands on the card that followed it in the grid (the one before it when it was last), so `f`, `e` and the arrow keys keep working without clicking.
- **Add to folder and back.** In a card's dialog choose "Add to folder…" from "More actions"; dialog "Folders" opens. `press` "Escape": it closes and focus is back on the card's dialog, so `press` "ArrowRight" moves to the next card.
- **Restore.** In `/trash`, `tap` the card first: its dialog shows the status "This card is in Trash" with buttons "Restore" and "Delete Forever", and the dialog's "More actions" has neither. A note or quote there is read-only: it has no "Focus" button and typing into it changes nothing (reload to confirm). `tap` "Delete Forever", then "Cancel" in "Delete this card forever?": focus returns to the "Delete Forever" button and `i` still hides and shows "Card details". Close it with Escape. Then right-click the card and choose "Restore" (the menu has only "Restore" and "Delete Forever"). The card leaves Trash and the toast "Card restored" appears (it can land a moment after the card leaves, so observe again). Proof: searching the marker in Everything finds it again.
- **Delete forever.** The card must be in Trash: after Restore, move it back with "Delete" from its menu in Everything. Then in `/trash`, right-click the card and choose "Delete Forever". Alert dialog "Delete this card forever?" opens. `tap` its "Delete Forever". The toast "Card permanently deleted" appears and the card leaves Trash. Proof: Trash and a marker search both show nothing.
- **Edit link.** Save a marked link (`https://example.com/verify-<run-id>`) and find it. Right-click it and choose "Edit link…": dialog "Edit link" opens with textbox "Address" holding the address and the line "Saving a new address refreshes the card’s preview." Type `not a link` and press Enter: the alert "Use an http or https link." shows and nothing saves. Replace it with `https://example.org/verify-<run-id>` and press Enter: the toast "Link saved. Its preview will refresh in a moment." appears and the dialog closes. Proof: open the card; its main button opens the new address and "Card details" shows the new site once processing settles (the local stack's link fetching fails, so its preview stage ends failed there). Do the same from the dialog's "More actions" → "Edit link…". A link with highlights refuses with "Remove this link's highlights before changing its URL". Notes, quotes and files have no "Edit link…", and neither does a link in Trash.
- **Empty Trash.** Use an account whose Trash you can empty: a local-stack account, or a dev account after asking (it also deletes Trash's seeded card). Move two marked cards to Trash, then open `/trash`. `tap` "Empty Trash" in the header (icon only on phones): alert dialog "Empty Trash?" says "This permanently deletes 2 cards and their files. This can’t be undone." (500 or more reads "500 or more cards"). "Cancel" closes it and changes nothing. `tap` its "Empty Trash": the toast "Deleting 2 cards forever" appears, the cards leave the grid within seconds, and Trash shows "Trash is empty." with "Empty Trash" disabled. Proof: `GET /v1/cards/<id>` for each card is 404, and a second browser on `/trash` emptied live. With `/trash` open, `⌘K` lists "Empty Trash" under Actions and opens the same confirmation; it isn't listed on other pages. Calling it more than three times a minute toasts "Trash was emptied a few times just now. Try again in a minute."
- **Bulk.** Make two marked cards. Right-click one and choose "Select", then `tap` the other (it becomes pressed). The bar reads "2 cards selected" with buttons "Archive", "More actions" and "Cancel selection". "More actions" opens menu "More actions" with "Add to favorites", "Remove from favorites", "Add tags…", "Remove tags…", "Copy links", "Add to folder…", "Move to folder…" and "Move to Trash". "Move to Trash" gives the toast "Moved 2 cards to Trash", and the marker search shows "Nothing found matching your filters".

## Gotchas

- Every card has a "More actions" button, and so do the dialog and the bulk bar. Scope to the dialog or the right-clicked card.
- Hover buttons are invisible and untabbable until hovered. Right-click is the reliable path.
- The dialog focuses itself, so single letters act at once: `f` favorites, `e` archives, `c` copies, `o` opens the link in a new tab, Delete deletes. Click into a field before typing.
- "Mark as …" for a link is a pill at the top of "Card details", and also in "More actions". With details hidden, use the menu or `d`.
- Toasts are brief. Check the state (views, search, reload) rather than relying on the toast alone.
- "Delete" moves to Trash, and only "Delete Forever" and "Empty Trash" in Trash are permanent. "Empty Trash" empties the whole account's Trash, hidden cards and the seeded card included: never press it on a shared account without asking.
- Restore toasts "Card restored" and Delete Forever toasts "Card permanently deleted", from the Trash grid and the dialog alike. Both can arrive just after the card leaves the grid.
- Trash starts with one seeded card, "Old draft I meant to throw away." Leave it there.
- The grid's tag dialog (right-click → "Add tags…", or `t`) reads the card itself, not the list: on `/?tag=<tag>`, removing that tag empties the grid behind the dialog, the dialog keeps the card's other tags, and the next tag added joins them.
- Adding the tag "secret" or "hidden" hides the card ("Hidden. Search #secret to see it.", with "Undo").
- A card holds at most 100 tags of at most 64 characters each. Pressing Enter in "Add a tag" with a longer tag shows the toast "Each tag must be at most 64 characters", keeps the text in the box and adds nothing; on a card with 100 tags it says "A card can have at most 100 tags". A long tag a card saved before the limit stays and doesn't block other tag edits. Tags → "Rename…" says "Tags can be at most 64 characters" before you save.
- On the dev deployment, real AI adds its own "Remove Teak tag …" chips. Don't confuse them with yours.
- The e2e MCP browser runs in UTC, where a time-zone bug in "Taken" can't show. Drive photo details from a Playwright context with `timezoneId` set instead.
- The Files Worker fixture `fixture-exif.jpg` isn't a decodable image ("Uploaded file is not a decodable image"); upload a real JPEG.
- Escape closes the dialog and returns focus to the card. In selection mode it clears the selection first.
- Closing a card opened from the grid goes Back to the grid's history entry, so opening and closing cards adds no history: from `/settings`, open Everything, open and close two cards, then Back once lands on `/settings`. A card reached by a link, or a close that changes the search (a tag, a type, "More like this"), replaces the URL instead.
