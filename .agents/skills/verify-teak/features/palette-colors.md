# Palette colors

A palette card's colors can be added and removed after saving, in the card dialog and through the API, MCP, SDK and CLI. Color search follows at once; the AI summary and tags don't refresh.

## Sub-features

- `palette-add` adds a color from the dialog's "Add color" popover: picker and "Hex code" stay in sync; `#RGB` or `#RRGGBB`, `#` optional, saves as `#RRGGBB`, "Enter a hex code, such as #FF5500" or "#… is already in this palette" keep "Add" disabled, and Return submits.
- `palette-remove` removes a color with its "Remove #…" button ("×", on hover or always on touch screens) or the swatch's right-click "Remove color"; toast "Removed #…" has **Undo**, re-adding it at the end. Every copy of a repeated color goes; one saved with alpha (`#FF000080`, from pasted text) is removed by its RGB ("Removed #FF0000").
- `palette-limits` hides "Add color" at 12 colors and every remove control at one; the server refuses a 13th ("A palette holds up to 12 colors") and the last one ("A palette needs at least one color"). Cards in Trash and non-palettes can't change colors.
- `palette-search` finds the card by an added color (`#hex` + Return makes a color chip, `?color=<hex>`), not by a removed one.
- `palette-api` takes `addColors` and `removeColors` (1–12 hex codes each) on `PATCH /v1/cards/<id>`, MCP's `teak_v1_update_card` and the SDK's `cards.update`; removes apply first, so one request can swap a color on a full or one-color palette. `teak cards update <id> --add-color <hex> --remove-color <hex>` (both repeatable) sends them.

## How to get to it (user POV)

- Web: open a palette card (Everything, or `type:palette`); "Add color" is under the swatches, each with "Copy #…" and "Remove #…".
- API, MCP, SDK, CLI: update the card by id.
- Apple and Android: [Apple app](./apple.md), [Android app](./android.md).

## Driving it with the e2e MCP server and the CLI

- **Make a palette.** In the composer, save `#E63946 #F1FAEE #457B9D verify-<run-id>`; it becomes "Palette: …" in about 30 s. Never edit a seeded palette.
- **Add.** Open it, `tap` "Add color": textbox "Pick a color" (`#ff5500`), textbox "Hex code" (focused), disabled "Add". `type` "teal-ish": "Enter a hex code, such as #FF5500". `type` "2a9d8f" with `replace`: "Pick a color" reads `#2a9d8f`, "Add" enabled. `press` "Enter": the popover closes, "Copy #2A9D8F" appears. An existing color shows "#E63946 is already in this palette"; `press` "Escape".
- **Remove and Undo.** `hover` "Copy #457B9D" shows "×"; `right_click` gives menuitem "Remove color". Remove it: the swatch leaves at once, then listitem "Removed #457B9D Undo" appears; `tap` "Undo" within 10 s (observe, then tap, nothing between) and the color comes back last.
- **Search.** Remove "#457B9D" again, close the dialog, `type` `#2A9D8F` in "Search everything" and `press` "Enter": chip "Remove #2A9D8F" and the palette show. `navigate` `/?color=457b9d`: "Nothing found matching your filters".
- **Limits and live updates.** With the dialog open, fill the palette to 12 through the CLI (below): swatches arrive without a reload and "Add color" goes. At one color, no "Remove #…" or hover "×" is left.
- **CLI and API.** In this order, against the marked palette. From the repository root, with `TEAK_API_URL` and `TEAK_API_KEY` set ([api-cli-mcp](./api-cli-mcp.md); on the local E2E stack the API is the stack's `convexSite` port and the key is minted for the stack's account through `apiKeys:createUserApiKey`): `bun apps/cli/src/index.ts cards update <id> --add-color 264653 --add-color "#eaac8b" …` prints the card line; repeat until `cards get <id>` lists 12 `colors:`. One more `--add-color` exits 1 with "A palette holds up to 12 colors", and `PATCH` `{"removeColors":["#EAAC8B"],"addColors":["#000000"]}` answers 200 with the swap. `--add-color teal` exits 2 before sending; the `PATCH` on a text card answers 400 `TYPE_MISMATCH`. `PATCH` `removeColors` with all but one color, then the last one: 400 `INVALID_INPUT` "A palette needs at least one color".
- **MCP.** `tools/list` shows `addColors` and `removeColors` on `teak_v1_update_card`; `tools/call` with `removeColors` answers "Card updated" and the new `colors`.
- **Cleanup.** Delete the palette forever ([card-actions](./card-actions.md)); revoke the key.

## Gotchas

- A plain-text search for `#2A9D8F` (from `?q=`) matches the card's text (which still lists its original colors), not its colors; only the color chip searches colors.
- The removal toast waits for the server, showing after the swatch leaves; slow drivers can miss its 10 seconds.
- Escape with focus outside the popover closes the card dialog.
- Over five colors wrap at desktop width; the last row's swatches stretch.
