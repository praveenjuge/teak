# Tables in notes

A user types `/table` in a note on the web to add a 3×3 table with a header row, fills it with Tab, and adds or deletes rows and columns from the ⋯ button just above the table's top-right corner. Tables are stored as GFM Markdown, so the API, exports and the native apps keep the same text, and grid tiles read a table as "Cell · Cell / Cell · Cell". A note that already holds a top-level GFM table opens as a table; an aligned, ragged or quoted table stays literal Markdown. The iPhone, iPad, Mac and Android apps show the same tables read-only, and tick a note's checklist items from the card view.

## Sub-features

- `table-insert` adds a 3×3 table from the slash menu ("Table"), with "Header" shown in the empty first header cell. The hint isn't the cell's accessible name: an empty header cell is a `columnheader` with no name. In a list or quote it goes after the whole block.
- `table-keys` moves with Tab and Shift+Tab, adds a row from Tab in the last cell and from Enter in the last row, moves down a column with Enter, and removes an empty table with Backspace.
- `table-menu` shows the ⋯ button ("Table options") while a cell has the cursor or the pointer is over the table, and Alt+F10 focuses it. Its menu adds rows above and below and columns left and right, and deletes the row, the column or the table. The header row can't be deleted or have a row added above it, the last column can't be deleted, and adding stops at 20 columns and 200 rows; each disabled item says why.
- `table-paste` turns pasted lines into one line of the cell, keeps one pasted paragraph's formatting, and puts a pasted table after the table.
- `table-roundtrip` opens notes with tables without rewriting them, and keeps aligned, ragged, quoted and listed tables literal.
- `table-tiles` reads a table on a tile as cells joined by " · " and rows by " / ", with no pipes or empty cells; a note that opens with a table has no title line.
- `table-native` shows tables read-only in the Apple and Android card view (header row, sideways scroll, `[[` pills in cells, literal text for the tables the web keeps literal), and ticks checklist items there, moving them as the web does (`apple-note-tables`, `apple-tasks`, `android-note-tables`, `android-tasks`).

## How to get to it (user POV)

- Open a text card, the composer at the top of Everything, or Focus (⌘E) → type `/table` → "Table".
- Point at the table, or put the cursor in a cell, for the ⋯ button above its top-right corner; Alt+F10 from a cell focuses it.
- Tiles: Everything, or search `#scenario-note-tables`.
- Apple (iPhone, iPad, Mac) and Android: search `#scenario-note-tables` or `#scenario-checklists` and open a note; tables and checkboxes are in the card view. The edit sheet (pencil, Edit) still shows the Markdown.

## Driving it with Playwright (or e2e MCP)

Preconditions:

- Seed the pack from `packages/convex`: `bunx convex run devSeed:seedScenario '{"workosUserId":"<id>","scenario":"note-tables"}'`, with the id from `.agents/.state/dev-account.json`. It adds 12 notes and a pack card, all tagged `scenario-note-tables`.
- Mint a key (`scripts/api-key.ts mint`) to read stored strings with `GET $SITE/v1/cards/<id>`.

Steps:

- **Round-trip.** For each pack note, read its `content` and `updatedAt`, open `/?card=<id>`, close it, and read them again: both are unchanged. "An aligned table", "A ragged table" and "A table in a quote" show monospaced literal text with no `table` role; every other note shows a `table` (two for "Two tables back to back"). The 20 × 200 table scrolls sideways inside its wrapper, and the page doesn't (`document.documentElement.scrollWidth` equals the viewport, also at 390 px).
- **Insert and fill.** Create a note `verify-<run-id> comparison` through the API and open it. Put the cursor at its end, press Enter, type `/table`: the listbox "Formatting commands" offers "Table"; Enter inserts 3 header cells and 3 rows, with "Header" in the first header cell (`observe` lists that cell as a `columnheader` without the name "Header"). Type `Plan`, Tab, `Price`, Tab, `Seats`, then two more rows; Tab in the last cell adds a fourth row. Enter in the last row adds a fifth, and ⌘Z removes it.
- **Menu.** Hover the table: the button "Table options" sits just above its top-right corner, outside the cells, so the last header cell's text ("Seats") is never covered (its bounding box doesn't overlap that cell's). Click it, then "Add column right": 4 columns. Tab into the new column, press Alt+F10 (focus is on "Table options"), Enter, then "Delete column": 3 columns, and focus returns to the editor.
- **Save and reopen.** Close the dialog. `GET $SITE/v1/cards/<id>` has the marker line, a blank line and a GFM table with padded cells. Reopen: the table and its cells are there. Search the marker: the tile reads "Plan · Price · Seats / Free · $0 · 1 / …".
- **Paste.** In a cell, paste three lines: they join into one line of that cell. Paste a GFM table into a cell: a second top-level table appears after the first, and ⌘Z removes it.
- **Focus.** With the cursor in a cell, ⌘E opens Focus with the table; Tab moves between cells and the word count includes cell words. Esc twice saves nothing new when nothing changed.
- **Composer.** In the composer, type a marker, Enter, `/table`, fill a cell and press ⌘Enter: the saved card holds the table.
- **Native apps.** Sign in and launch as in [apple](./apple.md) or [android](./android.md), and seed `note-tables` and `checklists` for that account. Open "Two tables back to back": two tables with bold header rows and no `|` characters; the 20 × 200 table scrolls sideways inside the note while the page doesn't. "An aligned table", "A ragged table" and "A table in a quote" show their pipes as text. Open "Packing list", tap "Pack item 001": it ticks, struck through, and moves below the open items at once; `GET $SITE/v1/cards/<id>` shows `- [x] Pack item 001` as the last item and every other line unchanged, and the same note open on the web shows the tick live. Tap it again: it moves to the end of the open items. "Nested checklist": ticking "Level 2 first" moves it only within its sublist. For the failure path, turn on airplane mode (or stop the stack) and tap a box: it flips, then flips back with "Couldn't update the checklist. Try again." Untick what you ticked to leave the pack as seeded.
- **End to end (local stack).** `bun run --cwd packages/tests e2e src/web/note-tables.e2e.ts`.
- **Clean up.** Delete the cards you made by id (`DELETE $SITE/v1/cards/<id>`, then `?permanent=true`), and the pack's by the tag (`GET $SITE/v1/cards?tag=scenario-note-tables`). Never clean up with a keyword search: it matches any of the words and reaches seeded cards.

## Gotchas

- The editor reads a click's selection a moment after the click; wait a few hundred milliseconds before pressing keys that depend on the cell.
- The ⋯ menu acts on the cell with the cursor: after "Add column right" the cursor stays in its column, so Tab into the new one before deleting it.
- The `[[` card-link menu doesn't open inside a cell; a link's `|` would need escaping there.
- Native apps show tables read-only; editing one stays on the web, and their edit field shows the Markdown.
- The web keeps a whole note literal when one table in it is aligned, ragged or nested, so that note has no checkboxes on the web ("Checklist with a table" in `checklists`). The native apps keep only that table literal and still show the note's other blocks and checkboxes.
- A stale `apps/web/.next` can make the page reload in a loop on every load ("HMR hash mismatch" over the HMR socket); stop the stack, delete `apps/web/.next` and start it again.
