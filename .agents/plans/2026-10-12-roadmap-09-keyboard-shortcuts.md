## Goal

Make the web library fully usable from the keyboard: move through the masonry grid spatially, act on the focused card with single keys, jump between views with `g` sequences, and see every shortcut in a `?` dialog. Phase 9 of the [roadmap](2026-10-12-roadmap-00-roadmap.md).

## Depends on

- [Phase 4](2026-10-12-roadmap-04-sidebar-app-shell.md) (routed views for `g f`, `g a`, `g t`). Archive (`E`) comes from [Phase 3](2026-10-12-roadmap-03-archive-bulk-actions.md).

## Success Criteria

- The grid is one tab stop; arrow keys and J/K move focus to the visually nearest card (up, down, left, right), Enter opens, F favorites, E archives, Delete moves to Trash (with undo), X toggles selection, Esc clears selection or closes the modal.
- Global: `/` focuses search, N opens the new-card composer, U opens the file picker, `g f` / `g a` / `g t` go to Favorites, Archive and Trash, `?` opens the shortcuts dialog.
- No shortcut fires while typing in an input, textarea or contenteditable, or while a dialog other than the shortcuts dialog is open.
- Screen readers still announce each card's accessible label when focus moves.

## Context And Current Facts

- There is no global shortcut handler today. Existing key handling: `Card.tsx` cards are `role="button"` with `tabIndex={0}` and open (or toggle selection) on Enter or Space; `NotesEditModal.tsx` saves on Cmd/Ctrl+Enter; `text-editor/EditorControls.tsx` uses Cmd/Ctrl+K inside the editor.
- `grids/MasonryGrid.tsx` renders antd's `Masonry` with `columns = { xs: 1, sm: 2, md: 3, lg: 5, xl: 5, xxl: 5 }`. antd decides each card's column, so spatial navigation must read rendered positions (`getBoundingClientRect`), not array order.
- The grid can start with an `"add-form"` item (`AddCardFormComponent`) that must be skipped or reachable deliberately.
- `packages/ui/src/components/cards/__tests__/Card.keyboard.test.tsx` already covers Enter and Space on a card (happy-dom); it must stay green when cards move to roving `tabIndex`.
- shadcn `dialog.tsx` exists for the shortcuts dialog; no new primitive is needed.

## Constraints And Non-goals

- Web only; no Convex, schema or API change.
- No new dependency (no hotkeys library); a small hook plus a pure navigation function.
- Destructive keys (Delete) use the same optimistic update plus undo toast as the context menu.
- Shortcuts are not configurable in this phase.

## Backend

- None.

## Web

- `packages/ui/src/hooks/useKeyboardShortcuts.ts`: one `keydown` listener on `document`; ignores events from inputs, textareas, selects, contenteditable and open dialogs (except its own); supports two-key sequences (`g` then a letter within one second); ignores modifier combos except Shift for `?`.
- `packages/ui/src/lib/gridNavigation.ts`: pure `nextCardIndex(rects, currentIndex, direction)` choosing the nearest card in the direction by center distance with an overlap preference; J/K map to next/previous in reading order.
- `grids/MasonryGrid.tsx`: roving `tabIndex` (focused card `0`, others `-1`), restores focus after the modal closes, scrolls the focused card into view, loads the next page when moving past the last card.
- `packages/ui/src/components/modals/KeyboardShortcutsDialog.tsx`: grouped list (Grid, Go to, Global) using `<kbd>` styling from the existing type scale.
- Sidebar items and the bulk bar show shortcut hints in tooltips only.

## API / MCP / SDK / CLI

- None.

## Docs

- `features.mdx`: new "Keyboard shortcuts" subsection with the table.
- Ship-month changelog: "Keyboard shortcuts on the web".

## UI states

- Empty: on an empty library, grid keys do nothing; `?`, `/`, N and U still work.
- Loading: keys during the skeleton state are ignored; focus lands on the first card when it renders.
- One item / many items: arrows at an edge stay put; moving past the last loaded card loads more.
- Very long names: not applicable; the dialog wraps descriptions.
- Error: a failed favorite or archive from a key shows the same toast as the menu action.
- Rate-limited: not applicable.
- UI bar: visible focus ring on the focused card that matches the existing ring; dialog opens with the standard 150–200ms animation; keys listed in sentence case.

## Scenario seed packs

- Reuse `ordering` (1,000 cards, mixed heights for masonry), plus `keyboard-mixed`: very tall and very short cards side by side so spatial moves are non-trivial.

## Break-it checklist

- UI: hold an arrow key (no skipped or duplicated focus); press `g` then wait two seconds then `f` (no navigation); shortcuts while the notes editor, tag dialog or search popover is open (ignored); Delete then undo with the keyboard; resize from 1440px to 390px while a card is focused; screen-reader labels with VoiceOver; dark-mode focus ring.
- Backend: not applicable; rapid F presses must not race (`updateCardField` stays idempotent).

## Tests

- `packages/ui/src/lib/__tests__/gridNavigation.test.ts`: `test.each` over masonry layouts (uneven columns, single column, gaps) for all four directions and edges.
- `packages/ui/src/hooks/__tests__/useKeyboardShortcuts.test.tsx`: ignored inside inputs, contenteditable and dialogs; `g f` sequence and timeout; `?` with Shift.
- `packages/ui/src/components/cards/__tests__/Card.keyboard.test.tsx`: still opens on Enter and Space with roving `tabIndex`.
- `packages/tests/src/web/keyboard.e2e.ts`: `/` focuses search, arrows move focus, F favorites, E archives, Delete plus undo, `g a` navigates, `?` opens the dialog.

## Proof before the PR

- Video: a keyboard-only session: `/`, search, Esc, arrows through the grid, Enter, Esc, F, E, Delete and undo, X on three cards, `g t`, `?`.
- Screenshots: focus ring on a card (light and dark), shortcuts dialog, 390px and 1440px.

## Release gate

1. Narrow tests above, then the repo checks and `keyboard.e2e.ts`, `08-a11y.e2e.ts`, `02-web-journey.e2e.ts`.
2. Seed `keyboard-mixed`, run the break-it pass, fix and add regression tests.
3. Proof bundle as above.
4. PR, green CI, merge, deploy web only. Smoke-test production with a keyboard-only pass.

## Risks And Open Questions

- antd may re-flow columns after images load; recompute rects on each key press rather than caching them.
- Single-letter shortcuts can surprise assistive-technology users; the dialog documents them, and they never fire inside text fields.
