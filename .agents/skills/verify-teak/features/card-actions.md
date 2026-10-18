# Card actions

A user opens a card into a dialog to edit its notes, tags and folders, favorites it, archives it, moves it to Trash, restores it or deletes it forever. Several cards can be selected at once for bulk actions. Every change shows up in the matching view after a reload.

## Sub-features

- `card-open` opens a card dialog from the grid, a deep link or the palette.
- `card-notes` adds notes, which save on blur.
- `card-tags` adds and removes tags; "secret" and "hidden" hide the card.
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
- `/archive` and `/trash` for archived and deleted cards.

## Driving it with e2e MCP

Preconditions:

- Signed in, with a text card holding this run's marker ([capture](./capture.md)), found by searching for the marker ([find](./find.md)).
- Act on marked cards only. If a recipe touches a seeded card, undo it.

Steps:

- **Open.** `tap` "Text: verify-<run-id> …". Dialog "Note" opens and the URL gains `?card=<id>`. The header has "Previous card", "Next card", "Favorite", "More actions" and "Close". The aside is "Card details".
- **Notes.** `type` "verify-<run-id> note" into textbox "Notes", then `press` "Tab" to blur. The dialog's description reads "Saved". Proof: `navigate` to `/?card=<id>`; the Notes textbox shows the text.
- **Tags.** `type` "verify-<run-id>-tag" into textbox "Add a tag" and `press` "Enter". The button "Remove tag verify-<run-id>-tag" appears. Proof: reload and it's still there; searching `tag:verify-<run-id>-tag` finds the card.
- **Favorite.** In the dialog, `tap` "Favorite". It becomes "Unfavorite" (pressed). Close with "Close" or Escape. Proof: link "Favorites" lists the card. Tap "Unfavorite" to undo.
- **Archive.** Open the card's "More actions" (in the dialog, or by right-clicking the card) and choose "Archive". The toast "Archived 1 card" offers "Undo", and the card leaves Everything. Proof: `/archive` lists it. There, choose "Unarchive"; the toast "Returned 1 card to the library" appears.
- **Trash.** From the grid's menu, choose "Delete". The toast "Moved 1 card to Trash" offers "Undo". From the dialog's menu, the toast is "Card deleted". Proof: `/trash` lists the card.
- **Restore.** In `/trash`, right-click the card and choose "Restore" (the menu has only "Restore" and "Delete Forever"). The card leaves Trash with no toast. Proof: searching the marker in Everything finds it again.
- **Delete forever.** In `/trash`, right-click the card and choose "Delete Forever". Alert dialog "Delete this card forever?" opens. `tap` its "Delete Forever". The toast "Card permanently deleted" appears and the card leaves Trash. Proof: Trash and a marker search both show nothing.
- **Bulk.** Make two marked cards. Right-click one and choose "Select", then `tap` the other (it becomes pressed). The bar reads "2 cards selected" with buttons "Archive", "More actions" and "Cancel selection". "More actions" opens menu "More actions" with "Add to favorites", "Remove from favorites", "Add tags…", "Remove tags…", "Copy links", "Add to folder…", "Move to folder…" and "Move to Trash". "Move to Trash" gives the toast "Moved 2 cards to Trash", and the marker search shows "Nothing found matching your filters".

## Gotchas

- Every card has a "More actions" button, and so do the dialog and the bulk bar. Scope to the dialog or the right-clicked card.
- Hover buttons are invisible and untabbable until hovered. Right-click is the reliable path.
- The dialog focuses itself, so single letters act at once: `f` favorites, `e` archives, Delete deletes. Click into a field before typing.
- Toasts are brief. Check the state (views, search, reload) rather than relying on the toast alone.
- "Delete" moves to Trash, and only "Delete Forever" from Trash is permanent. There's no "Empty Trash" button.
- Restore from the Trash grid shows no toast; Delete Forever shows "Card permanently deleted". From the dialog, Restore toasts "Card restored".
- Trash starts with one seeded card, "Old draft I meant to throw away." Leave it there.
- Adding the tag "secret" or "hidden" hides the card ("Hidden. Search #secret to see it.", with "Undo").
- On the dev deployment, real AI adds its own "Remove Teak tag …" chips. Don't confuse them with yours.
- Escape closes the dialog and returns focus to the card. In selection mode it clears the selection first.
