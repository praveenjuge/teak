# Palette colors

A palette card's colors can be added and removed after it's saved. In the card dialog, "Add color" under the palette opens a color picker and a hex field; each swatch has a "×" (on hover, or always on touch screens) and a right-click "Remove color", with an Undo toast. The API, MCP, SDK and CLI add and remove colors on the same card. Color search follows the change at once, and the AI summary and tags don't refresh.

## Sub-features

- `palette-add` adds a color from the card dialog's "Add color" popover: the picker and "Hex code" field stay in sync, `#RGB` or `#RRGGBB` with or without `#` is accepted and saved as `#RRGGBB`, "Enter a hex code, such as #FF5500" or "#… is already in this palette" keep "Add" disabled, and Return submits.
- `palette-remove` removes a color with its "Remove #…" button or the swatch's right-click "Remove color"; the toast "Removed #…" has **Undo**, which adds it back at the end. Every copy of a repeated color goes. A color saved with alpha (`#FF000080`, from pasted text) is removed by its RGB: the toast reads "Removed #FF0000".
- `palette-limits` hides "Add color" at 12 colors and every remove control at one color; the server refuses a 13th color ("A palette holds up to 12 colors") and the last one ("A palette needs at least one color"). Cards in Trash and cards that aren't palettes can't change their colors.
- `palette-search` finds the card by an added color (`#hex` + Return in the search box makes a color chip, `?color=<hex>`) and stops finding it by a removed one.
- `palette-api` takes `addColors` and `removeColors` (1–12 hex codes each) on `PATCH /v1/cards/<id>`, MCP's `teak_v1_update_card` and the SDK's `cards.update`; removes apply first, so one request can swap a color on a full or one-color palette. `teak cards update <id> --add-color <hex> --remove-color <hex>` (both repeatable) sends them.

## How to get to it (user POV)

- Web: open a palette card (Everything, or `type:palette`); "Add color" is under the swatches, and each swatch has "Copy #…" and "Remove #…".
- API, MCP, SDK, CLI: update a palette card by id.
- Apple and Android: steps in [Apple app](./apple.md) and [Android app](./android.md).

## Driving it with the e2e MCP server and the CLI

- **Make a palette.** In the composer, save `#E63946 #F1FAEE #457B9D verify-<run-id>`; it becomes "Palette: …" after processing (about 30 s). Edit only this card, never a seeded palette.
- **Add.** Open it, `tap` button "Add color": a dialog with textbox "Pick a color" (`#ff5500`), textbox "Hex code" (focused) and a disabled "Add". `type` "teal-ish": "Enter a hex code, such as #FF5500". `type` "2a9d8f" with `replace`: "Pick a color" reads `#2a9d8f` and "Add" is enabled. `press` "Enter": the popover closes and button "Copy #2A9D8F" appears. `tap` "Add color" again and type an existing color: "#E63946 is already in this palette"; `press` "Escape" to close it.
- **Remove and Undo.** `hover` "Copy #457B9D" shows its "×"; `right_click` it for menuitem "Remove color". Remove it: "Copy #457B9D" leaves at once and, once the server confirms, listitem "Removed #457B9D Undo" appears; `tap` "Undo" within 10 s (observe, then tap, with nothing in between) and the color comes back last.
- **Search.** Remove "#457B9D" again (no Undo this time) and close the dialog. `type` `#2A9D8F` in "Search everything" and `press` "Enter": the chip "Remove #2A9D8F" and the palette show. `navigate` `/?color=457b9d`: "Nothing found matching your filters".
- **Limits and live updates.** Open the palette again and keep the dialog open while you fill it to 12 through the API or CLI (below): the new swatches arrive without a reload and "Add color" goes. Remove down to one: no "Remove #…" is left, and hovering shows no "×".
- **CLI and API.** Run these in this order against the marked palette, so each limit has the palette it needs. From the repository root, with `TEAK_API_URL` and `TEAK_API_KEY` set ([api-cli-mcp](./api-cli-mcp.md); on the local E2E stack the API is the stack's `convexSite` port and the key is minted for the stack's account through `apiKeys:createUserApiKey`): `bun apps/cli/src/index.ts cards update <id> --add-color 264653 --add-color "#eaac8b" …` (repeat `--add-color` until `cards get <id>` lists 12 `colors:`) prints the card line. On that full palette, one more `--add-color` exits 1 with "A palette holds up to 12 colors", and `PATCH` `{"removeColors":["#EAAC8B"],"addColors":["#000000"]}` answers 200 with the swap. `--add-color teal` exits 2 before sending, and the same `PATCH` on a text card answers 400 `TYPE_MISMATCH`. Then `PATCH` `removeColors` with all but one color, and `removeColors` with the last one: 400 `INVALID_INPUT` "A palette needs at least one color".
- **MCP.** `tools/list` shows `addColors` and `removeColors` on `teak_v1_update_card`; `tools/call` with `removeColors` answers "Card updated" with the new `colors`.
- **Cleanup.** Delete the marked palette forever ([card-actions](./card-actions.md)) and revoke the key.

## Gotchas

- A plain-text search for `#2A9D8F` (from `?q=`) looks for those characters in the card's text, not its colors; the color chip is what searches colors. The card's text still lists the colors it was saved with.
- The removal toast waits for the server, so it shows a moment after the swatch leaves; slow drivers can miss its 10 seconds.
- Escape with focus outside the popover closes the whole card dialog.
- More than five colors wrap onto another row at desktop width, and the last row's swatches stretch.
