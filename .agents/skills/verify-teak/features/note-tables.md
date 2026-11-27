# Tables in notes

A user types `/table` in a web note to add a table with a header row, fills it with Tab, and edits rows and columns from a ⋯ menu. Tables are stored as GFM Markdown, so the API, exports and native apps keep the same text. The Apple and Android apps show tables read-only and tick checklist items from the card view.

## Sub-features

- `table-insert` adds a 3×3 table from the slash menu ("Table"), with the hint "Header" in the empty first header cell (not its accessible name). In a list or quote it goes after the whole block.
- `table-keys` moves with Tab and Shift+Tab, adds a row from Tab in the last cell and from Enter in the last row, moves down a column with Enter, and removes an empty table with Backspace.
- `table-menu` shows the ⋯ button ("Table options") while a cell has the cursor or the pointer is over the table; Alt+F10 focuses it. Its menu adds rows (above, below) and columns (left, right) and deletes the row, column or table. The header row can't be deleted or have a row added above it, the last column can't be deleted, and adding stops at 20 columns and 200 rows; each disabled item says why.
- `table-paste` joins pasted lines into one line of the cell, keeps one pasted paragraph's formatting, and puts a pasted table after the table.
- `table-roundtrip` opens notes with top-level GFM tables as tables without rewriting them and keeps aligned, ragged, quoted and listed tables literal.
- `table-tiles` reads a table on a tile as cells joined by " · " and rows by " / ", with no pipes or empty cells; a note that opens with a table has no title line.
- `table-native` shows tables read-only in the Apple and Android card view (`[[` pills in cells, literal text where the web keeps it), and ticks and moves checklist items like the web (`apple-note-tables`, `apple-tasks`, `android-note-tables`, `android-tasks`).

## How to get to it (user POV)

- A text card, the Everything composer, or Focus (⌘E) → `/table` → "Table".
- Hover the table or click a cell for the ⋯ button, or press Alt+F10 in a cell.
- Tiles: Everything or `#scenario-note-tables`.
- Apple and Android: search `#scenario-note-tables` or `#scenario-checklists` and open a note; the edit sheet (pencil, Edit) shows the Markdown.

## Driving it with Playwright (or e2e MCP)

Preconditions:

- Seed the pack from `packages/convex`: `bunx convex run devSeed:seedScenario '{"workosUserId":"<id>","scenario":"note-tables"}'`, with the id from `.agents/.state/dev-account.json`. It adds 12 notes and a pack card tagged `scenario-note-tables`.
- Mint a key (`scripts/api-key.ts mint`) to read stored strings with `GET $SITE/v1/cards/<id>`.

Steps:

- **Round-trip.** Each pack note's `content` and `updatedAt` are unchanged after opening and closing `/?card=<id>`. "An aligned table", "A ragged table" and "A table in a quote" show monospaced literal text with no `table` role; every other note shows a `table` (two for "Two tables back to back"). The 20 × 200 table scrolls sideways inside its wrapper, not the page (`document.documentElement.scrollWidth` equals the viewport, also at 390 px).
- **Insert and fill.** Create a note `verify-<run-id> comparison` via the API, open it, press Enter at its end and type `/table`: the listbox "Formatting commands" offers "Table"; Enter inserts 3 header cells and 3 rows; `observe` lists the first header cell as a `columnheader` without the name "Header". Type `Plan`, Tab, `Price`, Tab, `Seats`, then two more rows; Tab in the last cell adds a fourth row. Enter in the last row adds a fifth; ⌘Z undoes it.
- **Menu.** Hover the table: "Table options" appears above its top-right corner; its bounding box doesn't overlap the "Seats" cell's. Click it, then "Add column right": 4 columns. Tab into the new column, press Alt+F10 (focus moves to "Table options"), Enter, "Delete column": 3 columns, and focus returns to the editor.
- **Save and reopen.** Close the dialog. `GET $SITE/v1/cards/<id>` has the marker line, a blank line and a GFM table with padded cells. Reopen: the table is there. Searched, the tile reads "Plan · Price · Seats / Free · $0 · 1 / …".
- **Paste.** Paste three lines into a cell: they join into one line. Paste a GFM table into a cell: a second top-level table follows the first; ⌘Z removes it.
- **Focus.** With the cursor in a cell, ⌘E opens Focus with the table; Tab moves between cells and the word count includes cell words. Esc twice with no change saves nothing.
- **Composer.** Type a marker, Enter, `/table`, fill a cell, ⌘Enter: the saved card holds the table.
- **Native apps.** Launch as in [apple](./apple.md) or [android](./android.md), seeding `note-tables` and `checklists` for that account. "Two tables back to back": bold header rows, no `|`; the 20 × 200 table scrolls sideways inside the note, not the page. The three literal tables show their pipes as text. In "Packing list", tap "Pack item 001": it ticks, strikes through and drops below the open items at once; `GET $SITE/v1/cards/<id>` shows `- [x] Pack item 001` as the last item with every other line unchanged, and the web ticks live. Tap again: it returns to the end of the open items. "Nested checklist": ticking "Level 2 first" moves it only within its sublist. With airplane mode on (or the stack stopped), a tapped box flips, then flips back with "Couldn't update the checklist. Try again." Untick what you ticked.
- **End to end (local stack).** `bun run --cwd packages/tests e2e src/web/note-tables.e2e.ts`.
- **Clean up.** Delete your cards by id (`DELETE $SITE/v1/cards/<id>`, then `?permanent=true`), and the pack's by tag (`GET $SITE/v1/cards?tag=scenario-note-tables`). Never clean up by keyword search: it matches any word and reaches seeded cards.

## Gotchas

- The editor reads a click's selection a moment late; wait a few hundred milliseconds before cell-dependent keys.
- The ⋯ menu acts on the cursor's cell, which stays put after "Add column right": Tab into the new column before deleting it.
- The `[[` card-link menu doesn't open inside a cell; a link's `|` would need escaping there.
- Native apps can't edit tables.
- The web keeps a whole note literal when one table in it is aligned, ragged or nested, with no checkboxes ("Checklist with a table" in `checklists`); native apps keep only that table literal and still show checkboxes.
