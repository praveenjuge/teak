# Markdown editor

Web uses the published editorcn block editor and Tiptap's Markdown
extension. The public component still accepts and emits Markdown strings. Mobile,
extensions, storage, APIs, and previews keep their existing contracts.

`@editorcn/block-editor` is pinned to **0.2.0**: the inspected 0.3.x npm tarballs
declare `dist` exports but omit those files. Tiptap packages are pinned together
to **3.31.4**. Keep the compatibility corpus and browser journeys green when
upgrading the beta Markdown extension. References:
[editorcn documentation](https://www.rtecn.space/docs),
[Tiptap Markdown documentation](https://tiptap.dev/docs/editor/markdown).

## Preservation

Opening or selecting a note never rewrites its string. Supported documents use
rich blocks after schema validation and an independent Markdown semantic comparison.
Actual rich edits may normalize syntax. Frontmatter, reference definitions, image
references, raw HTML, unsafe links, and unsupported syntax stay editable as literal
text in the same block editor. Literal edits serialize verbatim. There is no source
mode or mode switch. Images are never loaded by the editor.

Pastes use plain text. Supported Markdown becomes blocks; unsupported pasted
content becomes literal text. Links permit only safe HTTP/HTTPS URLs. Transactions
reject content over 512 KiB in UTF-8.

## Tables

GFM tables at the top level open as rich tables (`@tiptap/extension-table`,
pinned with the other Tiptap packages). A table stays literal text when it
has column alignment (`:---`), rows with a different number of cells, HTML in
a cell, or sits inside a quote or list. Each cell holds one line of inline
text; a line break that lands in a cell becomes a space, and the schema keeps
tables at the top level (`tableEditing.ts`). The `[[` card-link menu stays
out of cells: a link's `|` would be escaped there, and the parsers outside
the editor don't read `\|`.

`/table` inserts a 3×3 table with a header row (after the whole block when
the cursor is in a list or quote). Tab and Shift+Tab move between cells, Tab
in the last cell and Enter in the last row add a row, and Backspace in an
empty table removes it. The ⋯ button at the table's top-right (Alt+F10 from a
cell) adds and deletes rows and columns, and deletes the table. Adding stops
at 20 columns and 200 rows; the header row and the last column stay. There is
no merging, alignment or resizing.

Slash commands, standard formatting shortcuts, and Cmd/Ctrl K for links work
alongside contextual formatting. There are no block movement controls or shortcuts.
Cmd/Ctrl Enter saves; Cmd/Ctrl E opens Focus where supplied. A ticked task item moves below the open items in its list, and back up when unticked, in one undo step.
Existing card save-on-close behavior is preserved. Composer fullscreen close
returns to the unsaved compact draft.

## Verification

The browser specs run on the E2E suite's local stack (the WorkOS emulator and a
local backend). Tests create their own accounts and cards and remove them
afterward. Never use production credentials.

```sh
bun test apps/web/src/components/text-editor/__tests__
bun run --cwd packages/tests e2e src/web/markdown-editor.e2e.ts
```

A failed spec names its trace page, with steps, screenshots and the app log, under
`packages/tests/.e2e/chromium/results/`. Shipping is blocked by silent loss, unexpected writes,
unsafe execution, or a failed required journey.
