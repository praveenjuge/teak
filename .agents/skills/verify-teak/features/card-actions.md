# Card actions

A user opens a card into a dialog to edit its notes, tags and folders, favorites it, archives it, moves it to Trash, restores it or deletes it forever. Several cards can be selected at once for bulk actions. Every change shows up in the matching view after a reload.

## Sub-features

- `card-open` opens a card dialog from the grid, a deep link or the palette.
- `card-dialog-layout` keeps the dialog's header to the title, "Favorite", "More actions" and one main action ("Open" for a link, "Download" for a file). "Previous card", "Next card" and "Close" sit outside the card on wide screens and in a bottom bar ("Card actions") on phones. Image and video cards float the header over the media until hovered. "Previous card", "Next card" and "Close" stay at one spot on screen whatever the card's size, and every quick click moves exactly one card.
- `card-details-toggle` hides or shows the "Card details" panel ("Hide details" in the menu, or `i`); the choice is remembered.
- `card-photo-details` lists a photo's camera facts under "More details" in "Card details": Camera, Taken, Exposure, Aperture, Focal length and ISO, never its location. "Taken" is the time the camera's clock showed, the same in every viewer's time zone, followed by the offset ("UTC+5:30") when the photo recorded one. Photos processed before Teak stored the clock time still read "Taken" in the viewer's zone.
- `card-notes` adds notes, which save on blur.
- `card-tags` adds and removes tags; "secret" and "hidden" hide the card. Tags Teak added fold under "N suggested tags", where "Keep tag …" keeps one and "Remove Teak tag …" drops it.
- `card-folders` adds the card to a folder.
- `card-favorite` favorites and unfavorites a card from the grid or the dialog.
- `card-archive` archives and unarchives a card.
- `card-trash` moves a card to Trash, with "Undo".
- `card-restore` restores a card from Trash.
- `card-delete-forever` deletes a card from Trash for good.
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
- **Photo details.** Upload a JPEG named `verify-<run-id>-photo.jpg` whose EXIF has a capture time ([capture](./capture.md)); Pillow can make one: `img = Image.new("RGB", (640, 480))`, `exif = img.getexif()`, set `exif[0x010F] = "Teak Camera Co"` (Make) and `exif[0x0110] = "Verify One"` (Model), then in `ifd = exif.get_ifd(0x8769)` set `ifd[0x9003] = "2026:05:17 14:30:05"` (DateTimeOriginal), `ifd[0x8827] = 400` (ISO) and, for the offset, `ifd[0x9011] = "+05:30"`; save with `img.save(path, "JPEG", exif=exif.tobytes())`. Once processing finishes, open "Image: verify-<run-id>-photo.jpg" and `tap` "More details". Rows "Camera" ("Teak Camera Co Verify One"), "Taken" and "ISO" ("400") appear; "Taken" reads "May 17, 2026, 02:30 PM", with " UTC+5:30" after it when the photo has the offset. Proof: open the card again from a browser in another zone (Playwright `timezoneId: "America/Los_Angeles"` or `"Pacific/Auckland"`, `.agents/cloud.md`): "Taken" stays 02:30 PM while "Added" moves with the zone. A photo processed before the Files Worker stored the clock time (its `fileMetadata.exif` has `takenAt` but no `takenAtClock`) still moves with the zone (07:30 AM in Los Angeles) until `backfillExifClock` (`packages/convex/migration/backfillExifClock.ts`) has run on that deployment. Delete the card forever in cleanup.
- **Notes.** `type` "verify-<run-id> note" into textbox "Notes", then `press` "Tab" to blur. The header shows "Saved" for about two seconds, then nothing (a slow save shows "Saving…", a failed one "Couldn't save"). Proof: `navigate` to `/?card=<id>`; the Notes textbox shows the text.
- **Tags.** `type` "verify-<run-id>-tag" into textbox "Add a tag" and `press` "Enter". The button "Remove tag verify-<run-id>-tag" appears. Proof: reload and it's still there; searching `tag:verify-<run-id>-tag` finds the card.
- **Favorite.** In the dialog, `tap` "Favorite". It becomes "Unfavorite" (pressed). Close with "Close" or Escape. Proof: link "Favorites" lists the card. Tap "Unfavorite" to undo.
- **Archive.** Open the card's "More actions" (in the dialog, or by right-clicking the card) and choose "Archive". The toast "Archived 1 card" offers "Undo", and the card leaves Everything. Proof: `/archive` lists it. There, choose "Unarchive"; the toast "Returned 1 card to the library" appears.
- **Trash.** From the grid's menu, choose "Delete". The toast "Moved 1 card to Trash" offers "Undo". Proof: `/trash` lists the card.
- **Trash from the dialog.** Use a second marked card. Open it, choose "Delete" from the dialog's "More actions": the dialog closes and the toast "Card deleted" offers "Undo". `tap` "Undo"; the card is back in Everything. Delete the card for good in cleanup.
- **Restore.** In `/trash`, `tap` the card first: its dialog shows the status "This card is in Trash" with buttons "Restore" and "Delete Forever", and the dialog's "More actions" has neither. Close it with Escape. Then right-click the card and choose "Restore" (the menu has only "Restore" and "Delete Forever"). The card leaves Trash and the toast "Card restored" appears (it can land a moment after the card leaves, so observe again). Proof: searching the marker in Everything finds it again.
- **Delete forever.** The card must be in Trash: after Restore, move it back with "Delete" from its menu in Everything. Then in `/trash`, right-click the card and choose "Delete Forever". Alert dialog "Delete this card forever?" opens. `tap` its "Delete Forever". The toast "Card permanently deleted" appears and the card leaves Trash. Proof: Trash and a marker search both show nothing.
- **Bulk.** Make two marked cards. Right-click one and choose "Select", then `tap` the other (it becomes pressed). The bar reads "2 cards selected" with buttons "Archive", "More actions" and "Cancel selection". "More actions" opens menu "More actions" with "Add to favorites", "Remove from favorites", "Add tags…", "Remove tags…", "Copy links", "Add to folder…", "Move to folder…" and "Move to Trash". "Move to Trash" gives the toast "Moved 2 cards to Trash", and the marker search shows "Nothing found matching your filters".

## Gotchas

- Every card has a "More actions" button, and so do the dialog and the bulk bar. Scope to the dialog or the right-clicked card.
- Hover buttons are invisible and untabbable until hovered. Right-click is the reliable path.
- The dialog focuses itself, so single letters act at once: `f` favorites, `e` archives, `c` copies, `o` opens the link in a new tab, Delete deletes. Click into a field before typing.
- "Mark as …" for a link is a pill at the top of "Card details", and also in "More actions". With details hidden, use the menu or `d`.
- Toasts are brief. Check the state (views, search, reload) rather than relying on the toast alone.
- "Delete" moves to Trash, and only "Delete Forever" from Trash is permanent. There's no "Empty Trash" button.
- Restore toasts "Card restored" and Delete Forever toasts "Card permanently deleted", from the Trash grid and the dialog alike. Both can arrive just after the card leaves the grid.
- Trash starts with one seeded card, "Old draft I meant to throw away." Leave it there.
- Adding the tag "secret" or "hidden" hides the card ("Hidden. Search #secret to see it.", with "Undo").
- A card holds at most 100 tags of at most 64 characters each. Pressing Enter in "Add a tag" with a longer tag shows the toast "Each tag must be at most 64 characters", keeps the text in the box and adds nothing; on a card with 100 tags it says "A card can have at most 100 tags". A long tag a card saved before the limit stays and doesn't block other tag edits. Tags → "Rename…" says "Tags can be at most 64 characters" before you save.
- On the dev deployment, real AI adds its own "Remove Teak tag …" chips. Don't confuse them with yours.
- The e2e MCP browser runs in UTC, where a time-zone bug in "Taken" can't show. Drive photo details from a Playwright context with `timezoneId` set instead.
- The Files Worker fixture `fixture-exif.jpg` isn't a decodable image ("Uploaded file is not a decodable image"); upload a real JPEG.
- Escape closes the dialog and returns focus to the card. In selection mode it clears the selection first.
