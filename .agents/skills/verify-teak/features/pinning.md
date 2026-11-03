# Pinned cards

A user pins up to 12 cards to keep them in a "Pinned" row above Everything: from a card's right-click or "More actions" menu ("Pin to top", "Unpin"), the `P` key on a focused or open card, the API, MCP, SDK or CLI. A new pin goes first; dragging a pinned card (or `Alt` with an arrow key) puts the row in another order, and pinned cards leave the grid below. The row shows only on Everything with no search, filter or other sort; elsewhere a pinned card ranks as usual and shows a pin in its corner, and `is:pinned` finds the pinned cards. Archiving or trashing a card unpins it; marking a link done keeps the pin. Pinning a 13th card is refused. Only the web app pins: the Apple and Android apps show pinned cards in their normal place and only suggest `is:pinned` in search.

## Sub-features

- `pin-toggle` pins and unpins from the grid's right-click and "More actions" menus ("Pin to top P", "Unpin P"), the open card's "More actions" menu, and `P` on a focused or open card. Archived cards and cards in Trash have no pin item, and `P` does nothing there or with cards selected.
- `pin-strip` shows the region "Pinned" (heading "Pinned", list "Pinned cards") above the grid on Everything, newest pin first. Pinned cards don't appear twice. The row hides for any search, filter, Favorites, Archive, Trash, a folder, or a sort other than Newest; the row is gone with no pins.
- `pin-mark` shows a pin ("Pinned") in a pinned card's corner, beside the heart when it is also a favorite.
- `pin-reorder` moves a card in the row by dragging the card itself (a short move first, so a click still opens it; on touch, a press-and-hold, so a swipe still scrolls the row), or with `Alt+←` / `Alt+→` on a focused pinned card, which keeps focus on it and says "Moved to position N of M." The order survives a reload, and the `?` sheet lists "Move a pinned card left or right".
- `pin-limit` refuses a 13th pin with the toast "You can pin up to 12 cards. Unpin one first." and pins nothing.
- `pin-lifecycle` unpins a card that is archived or moved to Trash (one card or a selection); unarchiving or restoring it doesn't pin it again; marking a link done keeps the pin.
- `pin-search` finds pinned cards with `is:pinned` (also `is:pin`, `is:pins`), leaves them out with `-is:pinned`, works inside `OR` and smart folders, and suggests "Pinned" after `is:` on the web and in the Apple and Android apps.
- `pin-api` pins with `PATCH /v1/cards/:id/pin`, lists with `GET /v1/cards?pinned=true` (pin order), reorders with `PUT /v1/cards/pinned/order`; MCP `teak_v1_set_card_pinned`, `teak_v1_list_pinned_cards`, `teak_v1_reorder_pinned_cards`; CLI `teak pin`, `teak cards pins`, `teak cards pins order`; WebMCP `teak_set_pinned`. Cards carry `isPinned`.
- `pin-export` writes `isPinned` (and `pinPosition` for a pinned card) to `cards.json` and an `isPinned` column to `cards.csv`; a Teak archive import pins those cards again, in order, up to 12.

## How to get to it (user POV)

- Everything (`/`) → right-click a card → "Pin to top", or focus it and press `p`.
- An open card → "More actions" → "Pin to top" / "Unpin", or `p`.
- The "Pinned" row above the grid → drag a card, or focus one and press `Alt+←` / `Alt+→`.
- Search box → `is:pinned`.
- `teak pin <id>`, `teak cards pins`, `GET /v1/cards?pinned=true`, MCP `teak_v1_list_pinned_cards`.

## Driving it with e2e MCP

Preconditions:

- A stack running this checkout's backend: the schema changed, so use `bun run dev --local --detach` (or `--push` on the shared deployment), then the doctor.
- Make three marked notes, `verify-<run-id> one`, `two`, `three`, from the composer or `POST /v1/cards`. For the cap, make 13 more with `POST /v1/cards/bulk` (`operation: "create"`).
- Mint a key (`scripts/api-key.ts mint`) for the API, CLI and MCP steps.

Steps:

- **Pin from the menu.** On Everything, `right_click` "Text: verify-<run-id> one" → "Pin to top". The region "Pinned" appears above the grid with that card, and the grid no longer lists it. Proof: `GET $SITE/v1/cards?pinned=true` has it with `isPinned: true`.
- **Pin with P.** Focus "Text: verify-<run-id> two" in the grid, `press` "p": it moves into "Pinned", before "one". Open "three", `press` "p" in the dialog, close it: "Pinned" reads three, two, one.
- **Reorder.** `focus` the first card in "Pinned cards", `press` "Alt+ArrowRight" twice: the row reads two, one, three, focus stays on the moved card, and the status reads "Moved to position 3 of 3." Reload: the same order. `drag` a pinned card onto another too; the card doesn't open when it's dropped. Proof: `teak cards pins` prints the same order.
- **Where the row shows.** Type `verify-<run-id>` in the search box: the row hides and the three notes list with a pin in their corner. Pick View → "Oldest": the row hides. Open Favorites: no row.
- **Search.** `is:pinned verify-<run-id>` lists the three; `verify-<run-id> -is:pinned` lists none of them; typing `is:` suggests "Pinned".
- **Cap.** Pin the 13 bulk cards through the API (`PATCH /v1/cards/<id>/pin` `{"isPinned":true}`) until it answers `400 PIN_LIMIT_REACHED`, then `press` "p" on another grid card: the toast "You can pin up to 12 cards. Unpin one first." appears and the row is unchanged.
- **Lifecycle.** Archive a pinned note (`e`): it leaves the row; unarchive it from Archive: it isn't pinned. Move one to Trash and restore it: not pinned.
- **API, CLI, MCP.** `PUT $SITE/v1/cards/pinned/order` with every pinned id reversed: 200 with `items` in that order, and the web row follows without a reload. The same call with one id missing: `400 INVALID_INPUT`. `bun apps/cli/src/index.ts pin <id> --remove` prints the card with "pinned" gone. MCP `teak_v1_set_card_pinned`, `teak_v1_list_pinned_cards` and `teak_v1_reorder_pinned_cards` do the same.
- **Export.** Export from Settings → Import & export; `cards.json` has `isPinned: true` and a `pinPosition` on each pinned card.
- **End to end (local stack).** `bun run --cwd packages/tests e2e src/journey/03-api.e2e.ts src/journey/04-cli.e2e.ts src/journey/05-mcp.e2e.ts`.
- **Clean up.** Unpin everything (`teak cards pins`, then `teak pin <id> --remove`), then delete the run's cards permanently.

## Gotchas

- Strip cards aren't in the grid, so the grid's arrow keys don't move into them; Tab reaches each pinned card.
- The row reads its cards on its own: right after pinning, the grid can drop the card a moment before the row shows it.
- A card hidden by a `secret` or `hidden` tag still counts toward the 12 but doesn't show in the row.
- A pinned card can't be dragged onto a sidebar folder (the drag moves it in the row instead); add it from its menu.
