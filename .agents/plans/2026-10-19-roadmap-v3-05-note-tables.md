## Goal

Insert and edit simple tables in text notes on the web. Tables are stored as GitHub-flavored Markdown, shown as real tables in the note view, and as clean text on grid tiles. Phase 5 of the [roadmap v3](2026-10-19-roadmap-v3-00-roadmap.md).

## Depends on

- Nothing.

## Success Criteria

- **Inserting:** typing `/table` (or "table" in the slash menu) inserts a 3×3 table with a header row and the cursor in the first header cell.
- **Keys:**
  - Tab moves to the next cell. Tab in the last cell adds a row.
  - Shift+Tab moves back.
  - Enter inside a cell moves to the same column in the next row (adding a row from the last one) and never splits the table. Cells are single-line, because a GFM table row can't hold a line break, and `<br>` would be HTML in a cell, which stays literal.
  - Backspace in an empty table with all cells empty removes it.
- **Hover menu:** hovering or focusing a cell shows a small "⋯" control at the table's top-right with:
  - Add row above, Add row below;
  - Add column left, Add column right;
  - Delete row, Delete column;
  - Delete table.

  Nothing else: no merging, no alignment, no resizing (owner decision: minimal).
- **Existing notes:** notes that already contain a GFM table (pasted, imported or typed) open as rich tables when they round-trip losslessly. Otherwise they stay literal Markdown, as today. Opening a note never rewrites its string.
- **Tiles:** `cards/CardBody.tsx` shows table text as "Cell · Cell · Cell / Cell · Cell · Cell", rows separated by " / ", with no pipes or dashes.
- **Elsewhere:** the native apps show the raw Markdown, unchanged. Export, the API and MCP return the Markdown string unchanged.

## Context And Current Facts

- **Editor:** Tiptap 3.31.4 plus `@editorcn/block-editor` 0.2.0 (`packages/ui/package.json:53–80`). `documentExtensions` (`text-editor/markdownDocument.ts:15–37`) is StarterKit, `LiteralMarkdown`, TaskList/TaskItem and `CardLinkNode`.
  - `@tiptap/extension-table` is not installed. `node_modules/@tiptap/` has no table package.
- **Tables stay literal:**
  - `markdownMeaning` (`markdownDocument.ts:43–106`) has no `table` case and throws "Unsupported Markdown" (line 105).
  - `mustStayLiteral` (around line 121) then keeps the source as a `literalMarkdown` block.
  - `text-editor/README.md:23–24` says so: "tables … stay editable as literal text" and "Table insertion and table controls are excluded."
- **Slash menu:**
  - `RichMarkdownEditor.tsx:38` uses editorcn's `defaultSlashCommandItems`, filtered by title and keywords (lines 155–160).
  - It is blocked inside `codeBlock` and `literalMarkdown` (lines 161–164).
  - It is rendered by `SlashMenu.tsx`.
- **Viewing:** a text card's modal (`card-previews/TextPreview.tsx:95`) is the editor itself, `MarkdownTextEditor`. Until the editor loads it shows `MarkdownStandIn.tsx`, which renders escaped text.
- **Storage:** Markdown in `cards.content`, capped at 512 KiB (`MARKDOWN_CONTENT_MAX_BYTES`, `shared/markdown.ts`).
- **Tiles:** `cards/CardBody.tsx:77–78,131,169` use `lib/markdownToPlainText.ts`. It has rules for links, code, headings, lists and emphasis, but none for tables, so pipes and `---` show.
- **Native apps:** `TeakCore/Logic/MarkdownBlocks.swift` and `core/model/.../MarkdownBlocks.kt` know heading, list, quote, code, rule and paragraph only. A table renders as paragraph text.
- **Tests:** `text-editor/__tests__/markdownDocument.test.ts`, `LoadedMarkdownTextEditor.test.tsx` and `FocusEditor.test.tsx`.

## Constraints And Non-goals

- **GFM tables only,** pinned to the same Tiptap version: `@tiptap/extension-table@3.31.4`, its row, header and cell nodes. Before building, confirm that `@tiptap/markdown` 3.31.4 parses and serializes tables through the extension's Markdown spec. If it doesn't, write the `parseMarkdown`/`renderMarkdown` pair in `text-editor/TableMarkdown.ts`.
- **Cells hold inline content only:** text, bold, italic, strike, code and links. Lists, headings, images and code blocks inside cells are not supported.
- **When a table stays literal:** a table that can't round-trip stays literal. That covers alignment markers (`:---`, `:---:`), escaped pipes inside cells, HTML in cells, and ragged rows. A literal table is still editable as text.
- **Caps for `/table` and the hover menu:** at most 20 columns and 200 rows. Pasted Markdown is limited only by 512 KiB.
- **Out of scope:** native rendering (later), and table support in `FileTextPreview` (document files).

## Web

- **`markdownDocument.ts`:**
  - Add the table extensions to `documentExtensions`.
  - Add a `table` case to `markdownMeaning`: `["table", header cells' meaning, rows' cells' meaning]`. It rejects (throws) any non-empty `align` entry, so aligned tables stay literal. It also throws for a table nested inside a blockquote or list item (the walk passes a nesting depth down), so those stay literal too; the editor only supports top-level tables.
  - `hasSameMarkdownMeaning` then guards round-trips as it does for every other block.
- **`RichMarkdownEditor.tsx`:**
  - Append a `Table` item to `commands`: title "Table", keywords `["grid", "columns", "rows"]`, `lucide-react` icon `Table`. It runs `insertTable({ rows: 3, cols: 3, withHeaderRow: true })`.
  - Hide the item while the cursor is already inside a table (no nested tables).
- **New `text-editor/TableMenu.tsx`:**
  - The "⋯" button is absolutely positioned at the table's top-right while a cell is focused or hovered. It opens a shadcn `DropdownMenu` with the 7 actions, with Delete table in the destructive variant.
  - It is keyboard reachable: Alt+F10 focuses it from a cell (the editor's toolbar convention), and Esc returns focus to the cell.
- **`editor.css`:**
  - the table fills the width with `table-layout: auto`;
  - 1px borders in `--border`;
  - a header row in `--muted` with medium weight;
  - cells padded 6px 10px;
  - horizontal scroll inside a wrapper at narrow widths, never page overflow;
  - the selected cell outlined in `--ring`;
  - correct in light and dark.
- **`MarkdownStandIn.tsx`:** keep it as escaped text. The stand-in only shows until the editor loads.
- **`lib/markdownToPlainText.ts`:** a table rule, run before the line-marker rules:
  - drop the delimiter row;
  - strip leading and trailing pipes;
  - join cells with " · " and rows with " / ".
  Rows can't go on separate lines: the pipeline collapses whitespace (`whitespaceRun`, `markdownToPlainText.ts:51`) and the tile clamps one paragraph (`CardBody.tsx:89`), so a separator is used instead.
- **`text-editor/README.md`:** replace the "Table insertion and table controls are excluded" line with the new behaviour and its limits.

## Backend

- None.

## API / MCP / SDK / CLI

- None. Notes stay Markdown strings.

## Docs

- `features.mdx`, the notes section: "Type /table to add a table. Tab moves between cells; the ⋯ menu adds or removes rows and columns." The note in the feature list that tables stay as text is removed.
- The month's changelog: "Tables in notes".

## UI states

- **A new table:** 3×3 with an empty header. The placeholder in the first header cell reads "Header".
- **One column, or one row:** the delete options for the last column or row are disabled ("Delete table" instead).
- **Wide tables:** at 390px the table scrolls sideways inside the note, with a soft fade on the scrolling edge.
- **Very long cell text:** it wraps, with a max column width of 40ch.
- **Literal table:** looks as today: monospaced Markdown text.
- **Focus mode (⌘E):** same table behaviour, and the word count includes cell text.
- **Error:** inserting past 20 columns or 200 rows disables the add actions, with the tooltip "Tables can have up to 20 columns" (or "200 rows").

## Scenario seed packs

- **`note-tables`:** 12 text cards:
  - a 3×3 table;
  - a 20×200 table;
  - a table with bold, links and inline code in cells;
  - an aligned table (stays literal);
  - a ragged table (stays literal);
  - a table with escaped pipes (stays literal);
  - CJK and RTL cells;
  - a table next to a checklist and a `[[` card link;
  - a note at 510 KiB with a table;
  - a note whose only content is a table;
  - two tables back to back;
  - a table inside a blockquote (stays literal).

## Break-it checklist

- **Undo and paste:**
  - Insert a table, type, then ⌘Z through every step.
  - Paste a GFM table from a spreadsheet as plain text.
  - Paste a table into a cell.
- **Table edits:**
  - Delete every column one by one.
  - Tab out of the last cell of a 200-row table.
- **Round-trip:** open each seeded note without editing, and the stored string is byte-identical (no save fires).
- **Other surfaces:** Focus mode, the composer (new note), and an existing note in the modal.
- **Two tabs** editing the same note.
- **Layout and input:** keyboard only, including the Alt+F10 menu; 390px; dark theme.
- **Native:** the Apple and Android apps open a note with a table (raw text, no crash).

## Tests

- `packages/ui/src/components/text-editor/__tests__/markdownDocument.test.ts`:
  - GFM tables round-trip;
  - aligned, ragged and escaped-pipe tables stay literal;
  - `hasSameMarkdownMeaning` for tables.
- `packages/ui/src/components/text-editor/__tests__/LoadedMarkdownTextEditor.test.tsx`: the slash menu lists Table; inserting one serializes a 3×3 GFM table.
- `packages/ui/src/components/card-previews/__tests__/markdownToPlainText.test.ts` (the existing file): the table rule, including a table followed by text and the row separator.
- `markdownDocument.test.ts` also covers a table inside a blockquote and inside a list item staying literal.
- `LoadedMarkdownTextEditor.test.tsx` also covers: Enter in a cell moving down (and adding a row from the last one), Shift+Tab moving back, Backspace removing an empty table, each of the 7 menu actions, and the 20-column and 200-row caps.
- Update the tests that assert a plain table stays literal: the unsupported-content cases in `markdownDocument.test.ts` (around line 50, `| Name | State |…`) move that table to the round-trip cases and keep an aligned table as the literal example; and `packages/tests/src/web/markdown-editor.e2e.ts:520` ("existing tables remain editable as literal Markdown without table controls"), which asserts no `table` role: it now uses an aligned table, which still stays literal, and a plain GFM table is covered by the new spec.
- e2e: `packages/tests/src/web/note-tables.e2e.ts` (new). `/table`, type in cells, Tab adds a row, use the menu to add and delete a column, reload, and the content is still there.

## Proof before the PR

- **Video 1:** `/table`, fill a 3-column comparison, Tab to add rows, use the ⋯ menu, close and reopen.
- **Video 2:** open the seeded aligned (literal) table and the 20×200 table.
- **Screenshots:** the table, hover menu and tile text, in light and dark at 390px and 1440px.

## Release gate

1. Run the narrow tests, the repo checks and the new e2e spec.
2. Seed `note-tables`, run the break-it pass, and fix and add regression tests until it is clean.
3. Send the proof bundle to the owner.
4. Merge, and deploy web. Smoke-test `/table` on production.

## Risks And Open Questions

- **Open decision (default: aligned tables stay literal).** Supporting alignment would mean an alignment control, and the owner chose minimal controls. Keeping alignment without a control would still round-trip, but adds parser work.
- **Open decision (default: Alt+F10 opens the table menu).** It matches toolbar accessibility conventions. An alternative is a visible button only.
- **Markdown support in `@tiptap/markdown`** for tables must be verified at 3.31.4. A hand-written serializer must emit stable pipes and padding, so the meaning check passes.
- **editorcn** may style or intercept table nodes unexpectedly. Check `BlockEditor` drag handles and the node-range extension with tables.
