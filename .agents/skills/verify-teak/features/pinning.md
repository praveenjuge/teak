# Pinned cards

A user pins up to 12 cards into a "Pinned" row above Everything from a card's menus, the `P` key, the API, MCP, SDK or CLI, and reorders the row by dragging or `Alt` with an arrow key. Elsewhere a pinned card ranks as usual with a pin in its corner. Only the web app pins: the Apple and Android apps show pinned cards in their normal place and only suggest `is:pinned` in search.

## Sub-features

- `pin-toggle` pins and unpins from the grid's right-click and "More actions" menus ("Pin to top P", "Unpin P"), the open card's "More actions" menu, and `P` on a focused or open card. Archived and trashed cards have no pin item; `P` does nothing there or with a selection.
- `pin-strip` shows the region "Pinned" (a screen-reader-only heading "Pinned", list "Pinned cards") above the grid on Everything, newest pin first; pinned cards leave the grid and show no pin of their own in the row. Each row card is one 168 px tile: images, videos and link previews crop to it, and links and documents drop their footer, so none has a caption. The row hides for any search, filter, Favorites, Archive, Trash, a folder, a sort other than Newest, or no pins.
- `pin-mark` shows a pin ("Pinned") in a pinned card's corner outside the row, beside the heart on a favorite.
- `pin-reorder` moves a card in the row by dragging it (a short move first, so a click still opens it; on touch, a press-and-hold, so a swipe still scrolls), or with `Alt+←` / `Alt+→` on a focused pinned card, which keeps focus and says "Moved to position N of M." The order survives a reload, and the `?` sheet lists "Move a pinned card left or right".
- `pin-limit` refuses a 13th pin with the toast "You can pin up to 12 cards. Unpin one first." and pins nothing.
- `pin-lifecycle` unpins a card that is archived or moved to Trash (one or a selection); Undo on that toast re-pins it in its old place (newer pins stay first), while a later unarchive or restore doesn't; marking a link done keeps the pin.
- `pin-search` finds pinned cards with `is:pinned` (also `is:pin`, `is:pins`), excludes them with `-is:pinned`, works inside `OR` and smart folders, and suggests "Pinned" after `is:` on the web, Apple and Android.
- `pin-api` pins with `PATCH /v1/cards/:id/pin`, lists with `GET /v1/cards?pinned=true` (pin order), reorders with `PUT /v1/cards/pinned/order`; MCP `teak_v1_set_card_pinned`, `teak_v1_list_pinned_cards`, `teak_v1_reorder_pinned_cards`; CLI `teak pin`, `teak cards pins`, `teak cards pins order`; WebMCP `teak_set_pinned`. Cards carry `isPinned`.
- `pin-export` writes `isPinned` (and `pinPosition` for a pinned card) to `cards.json` and an `isPinned` column to `cards.csv`; a Teak archive import re-pins those cards in order, up to 12.

## How to get to it (user POV)

- A card on Everything (`/`) or open → right-click or "More actions" → "Pin to top" / "Unpin", or `p`.
- The "Pinned" row → drag a card, or focus one and press `Alt+←` / `Alt+→`.
- Search box → `is:pinned`.
- `teak pin <id>`, `teak cards pins`, `GET /v1/cards?pinned=true`, MCP `teak_v1_list_pinned_cards`.

## Driving it with e2e MCP

Preconditions:

- A stack running this checkout's backend (the schema changed): `bun run dev --local --detach` (or `--push` on the shared deployment), then the doctor.
- Three marked notes, `verify-<run-id> one`, `two`, `three`, from the composer or `POST /v1/cards`; for the cap, 13 more with `POST /v1/cards/bulk` (`operation: "create"`).
- A key (`scripts/api-key.ts mint`) for the API, CLI and MCP steps.

Steps:

- **Pin from the menu.** On Everything, `right_click` "Text: verify-<run-id> one" → "Pin to top": it moves from the grid into the region "Pinned". Proof: `GET $SITE/v1/cards?pinned=true` has it with `isPinned: true`.
- **Pin with P.** Focus "Text: verify-<run-id> two", `press` "p": it moves into "Pinned", before "one". Open "three", `press` "p" in the dialog, close it: "Pinned" reads three, two, one.
- **Reorder.** `focus` the first card in "Pinned cards", `press` "Alt+ArrowRight" twice: the row reads two, one, three, focus stays on it, and the status reads "Moved to position 3 of 3." Reload: same order. `drag` one onto another; it doesn't open when dropped. Proof: `teak cards pins` prints the same order.
- **Where the row shows.** Search `verify-<run-id>`: the row hides and the three notes show a corner pin. View → "Oldest": the row hides. Favorites: no row.
- **Search.** `is:pinned verify-<run-id>` lists the three; `verify-<run-id> -is:pinned` lists none; typing `is:` suggests "Pinned".
- **Cap.** Pin the 13 bulk cards (`PATCH /v1/cards/<id>/pin` `{"isPinned":true}`) until it answers `400 PIN_LIMIT_REACHED`, then `press` "p" on another grid card: the toast "You can pin up to 12 cards. Unpin one first." appears and the row is unchanged.
- **Lifecycle.** With three pins, archive the middle one (`e`): it leaves the row. `tap` "Undo" on "Archived 1 card": after a reload it is back between the other two. Archive it again, unarchive it from Archive: not pinned. Trash the last pin (`Backspace`), `tap` "Undo" on "Moved 1 card to Trash": back last in the row. Trash one, restore it from Trash: not pinned.
- **API, CLI, MCP.** `PUT $SITE/v1/cards/pinned/order` with every pinned id reversed: 200 with `items` in that order; the web row follows live. With one id missing: `400 INVALID_INPUT`. `bun apps/cli/src/index.ts unpin <id>` prints the card without "pinned". MCP `teak_v1_set_card_pinned`, `teak_v1_list_pinned_cards` and `teak_v1_reorder_pinned_cards` do the same.
- **Export.** Settings → Import & export; `cards.json` has `isPinned: true` and a `pinPosition` on each pinned card.
- **End to end (local stack).** `bun run --cwd packages/tests e2e src/journey/03-api.e2e.ts src/journey/04-cli.e2e.ts src/journey/05-mcp.e2e.ts`.
- **Clean up.** Unpin everything (`teak cards pins`, then `teak unpin <id>`), then delete the run's cards permanently.

## Gotchas

- Strip cards aren't in the grid, so its arrow keys don't reach them; Tab does.
- The row loads separately: right after pinning, the grid can drop the card a moment before the row shows it.
- A card hidden by a `secret` or `hidden` tag counts toward the 12 but doesn't show in the row.
- A pinned card can't be dragged onto a sidebar folder (the drag reorders the row instead); add it from its menu.
