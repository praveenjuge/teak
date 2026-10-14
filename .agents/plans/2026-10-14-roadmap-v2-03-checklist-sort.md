## Goal

When you tick a checklist item in a note, it moves below the open items in its list. Unticking it moves it back up. Phase 3 of the [roadmap v2](2026-10-14-roadmap-v2-00-roadmap.md).

## Depends on

- Nothing.

## Success Criteria

- Ticking a task item moves it, with its nested children, to just after the last unticked sibling in the same list. Ticked items keep the order they had among themselves, so the item ticked most recently goes first in the done section.
- Unticking moves the item to the end of the open items in its list.
- Nested lists reorder only within their own level. A parent never moves because a child was ticked.
- The stored Markdown changes to match. One undo (⌘Z) restores both the tick and the position.
- Nothing moves when you:
  - open a note
  - paste Markdown
  - type `- [x] ` to create an item
  - change a mixed list where bullets and tasks sit side by side (only task lists reorder)

## Context And Current Facts

- The task extensions are in `text-editor/markdownDocument.ts` (`documentExtensions()`, lines 14–30): `TaskList` and `TaskItem.configure({ nested: true })` from `@tiptap/extension-task-list` / `extension-task-item` 3.31.4. The same list is used by `RichMarkdownEditor.tsx` and by `markdownManager` (`@tiptap/markdown`), which parses and serializes Markdown.
- TaskItem's checkbox node view changes the item's `checked` attribute in a transaction. A ProseMirror `appendTransaction` that sees `checked` go from false to true (or back) can move the node in the same history event, because prosemirror-history merges appended transactions into the event of the transaction that caused them.
- `RichMarkdownEditor.tsx` already runs a `filterTransaction` plugin (`teakMarkdownSafety`) that serializes every change and enforces the 512 KiB cap. A move keeps the same content, so it can't exceed the cap.
- `prepareMarkdownDocument` loads unsupported Markdown as one `literalMarkdown` block. Those notes have no task nodes, so nothing reorders in them.
- `hasSameMarkdownMeaning` compares lists item by item in order. A reordered list is a real content change, so it saves like any other edit.
- The text card in the grid is not interactive, so ticking only happens in the editor (the composer, the card modal and focus mode).

## Constraints And Non-goals

- UI only (`packages/ui`). No backend, API or native change. The Apple and Android editors keep their own behavior until a native follow-up chooses to match.
- Only toggles made by the user reorder (the transaction must carry a step that changes `checked`, and must not carry `teakExternalSync`). Loading, external syncs and pastes never reorder.
- No setting to turn it off in this phase.

## Backend

- None.

## Web

- `text-editor/taskListSort.ts`:
  - A pure `moveToggledTaskItem(state, tr) => Transaction | null`. It finds the `taskItem` whose `checked` attribute changed, then works out where it goes among its siblings in the parent `taskList`.
  - Ticked: after the last unticked sibling. Unticked: after the last unticked sibling other than itself.
  - It moves the whole node, children included, with one `ReplaceStep`.
  - A Tiptap `Extension` (`TaskListSort`) wraps it in an `appendTransaction` plugin.
- `text-editor/markdownDocument.ts`: add `TaskListSort` to the editor's extensions only (inside `RichMarkdownEditor`'s list), so `markdownManager` parsing is unaffected.
- The cursor stays in the moved item when the toggle came from the keyboard. A click on a checkbox keeps the existing selection.

## API / MCP / SDK / CLI

- None.

## Docs

- `features.mdx`: one sentence under notes: "Ticked checklist items move to the bottom of their list."
- Ship-month changelog: "Done items sink to the bottom of checklists".

## UI states

- **Empty:** a list whose items are all unticked does nothing. Ticking the last open item moves nothing.
- **Loading:** not applicable.
- **One / many items:**
  - A list with 1 item never moves.
  - With 200 items, the move is instant, and the view keeps the ticked item's old spot in view rather than jumping.
- **Very long names:** long item text wraps; the move is the same.
- **Error:** if the moved Markdown fails the round-trip safety check, the transaction is dropped and the tick stays where it was. Log it in development only.
- **Rate-limited:** not applicable.
- **UI bar:** no animation in this phase. A 150ms FLIP slide is a possible follow-up, but layout jumps must not be worse than today's.

## Scenario seed packs

- `checklists`: text cards with:
  - 200 task items
  - lists nested 5 levels deep
  - mixed bullet and task lists
  - all items ticked
  - Markdown with odd spacing (`-  [ ]`, blank lines between items, `*` bullets)
  - a task list inside a blockquote
  - a note with a table, so it loads as literal Markdown

## Break-it checklist

- **UI:**
  - Tick 10 items fast.
  - Tick, then ⌘Z, then ⌘⇧Z.
  - Tick while the slash menu or the link editor is open.
  - Tick in the composer, then save.
  - Tick in focus mode (phase 2).
  - Tick in two tabs.
  - Keyboard only: Space on a focused checkbox.
  - 390px.
- **Data:** a reload after saving shows the stored order. Untouched items never change their spacing (round trip). A nested child ticked moves only within its own sublist.

## Tests

- `packages/ui/src/components/text-editor/__tests__/taskListSort.test.ts`, as a `test.each` table. It parses Markdown with `markdownManager`, builds an `EditorState` with the editor's schema, toggles item N, applies `moveToggledTaskItem` and serializes. Cases:
  - tick the first of 3 items
  - tick the last open item
  - untick
  - nested lists
  - a child moving with its parent
  - mixed bullets
  - a task list inside a blockquote
  - a transaction with `teakExternalSync`, which leaves the list alone
- `packages/ui/src/components/text-editor/__tests__/markdownDocument.test.ts`: existing; must stay green.
- `packages/tests/src/web/markdown-editor.e2e.ts`: add a test. Tick the first item; it moves to the bottom. Reopen the card; the order is kept. ⌘Z restores it.

## Proof before the PR

- **Video:** tick and untick in a 10-item list, ⌘Z, then reopen the card.
- **Video, worst case:** the 5-level nested list and fast ticking.
- **Screenshots:** the before and after list, nested lists, literal-Markdown note unchanged. Each in light and dark, at 390px and 1440px.

## Release gate

1. Run the narrow tests, then the repo checks, plus `markdown-editor.e2e.ts`.
2. Seed `checklists`, run the break-it pass, then fix and add regression tests.
3. Send the proof bundle.
4. Open the PR; CI must be green. Merge and deploy the web app only. No backfill. Smoke-test production by ticking items in one real note.

## Risks And Open Questions

- Tiptap's checkbox node view might change `checked` through a transaction without a step the plugin recognizes (for example a `setNodeMarkup` with `addToHistory` false). Confirm against 3.31.4 before building on it, and pin the behavior with the e2e test.
- The Apple and Android editors won't reorder, so the same note behaves differently there. Should the native follow-ups (phases 29 and 31) include this?
