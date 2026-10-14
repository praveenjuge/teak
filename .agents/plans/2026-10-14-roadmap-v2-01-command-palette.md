## Goal

Add a ⌘K / Ctrl+K command palette to the web app. From one box you can jump to any view, folder or smart folder, find a card by typing, and run the common actions, all without the mouse. Phase 1 of the [roadmap v2](2026-10-14-roadmap-v2-00-roadmap.md).

## Depends on

- Nothing in v2. It builds on v1 phases 4 (sidebar and routed views), 5 and 8 (folders and smart folders) and 9 (keyboard shortcuts), which have all shipped.

## Success Criteria

- ⌘K (Apple) or Ctrl+K (everywhere else) opens the palette on every signed-in page. Pressing it again, or Esc, closes it, and focus goes back to where it was.
- **Navigate:** Everything, Favorites, Archive, Trash, Tags and Settings, plus every folder and smart folder by name (up to `MAX_FOLDERS_PER_USER = 500`).
- **Cards:** after 2 or more characters, up to 8 matches from the normal search, qualifiers included (`#tag`, `type:`, `site:`). Enter opens the card in the card modal (`?card=<id>`) on the current page.
- **Actions:** New note, Upload files, Import, Export, Toggle theme, Shuffle, Keyboard shortcuts and Sign out.
- It shows no recent searches and no recent cards (rejected in the master Decisions).
- Inside a text editor, ⌘K still edits a link. While another dialog, menu or popup list is open, ⌘K does nothing.
- ⌘K is listed in `KEYBOARD_SHORTCUT_GROUPS` and in the `?` dialog.

## Context And Current Facts

- There is no command palette, no `cmdk` dependency and no `command.tsx` (`packages/ui/src/components/ui/` has `dialog.tsx`, `kbd.tsx`, `dropdown-menu.tsx` and others, but no popover). `packages/ui/components.json` uses the shadcn `new-york` style with `lucide` icons. The current `cmdk` release is 1.1.1.
- `useKeyboardShortcuts` (`packages/ui/src/hooks/useKeyboardShortcuts.ts`) ignores any key pressed with Ctrl, Meta or Alt (`shortcutKey` returns null), so it cannot carry ⌘K. ⌘K needs its own listener. It should reuse the exported `isTypingTarget` and `isOverlayOpen` helpers rather than copy them.
- The editor's ⌘K handler is in `text-editor/EditorControls.tsx` (lines 63–71). It is a `keydown` listener on `editor.view.dom` that calls `preventDefault` and opens link editing, and it is mounted for every editable editor (the composer, the card modal and the full-screen note). `useKeyboardShortcuts` listens in the capture phase. The palette must instead listen on `document` in the bubble phase and skip events that are `defaultPrevented` or come from a `contenteditable`, so the editor always handles ⌘K first.
- A precedent for a modifier shortcut is the sidebar's ⌘B (`components/ui/sidebar.tsx:150-172`): a `window` listener that skips inputs and `contenteditable`.
- Global shortcuts are mounted once in `LibraryShortcuts` (`components/shortcuts/LibraryShortcuts.tsx`), inside `AppShell` (`apps/web/src/components/AppShell.tsx`). `AppShell` already has `handleGoToView` and `handleNewNote`.
- Routes: `/`, `/favorites`, `/archive`, `/trash` (`lib/libraryViews.ts`), `/tags`, `/settings` and `/f/[folderId]`. Folders come from `useFolders()` → `api.folders.listFolders`, sorted by name, with `kind: "manual" | "smart"`. Folder names can be up to 300 characters (`MAX_FOLDER_NAME_LENGTH` in `shared/folders.ts`).
- Card search goes through `api.cards.searchCardsPaginated` (`card/getCards.ts:894`). Cards open through the `?card=` query parameter (`hooks/useCardQueryParamState.ts`).
- Upload uses `pressUploadFiles()` and New note uses `focusNewNoteComposer()` / `requestNewNoteComposerFocus()`, both in `lib/keyboardShortcuts.ts`. The theme comes from `next-themes` (`settings/ThemeToggle.tsx`). Sign out is `signOut()` in `apps/web/src/lib/sign-out-client.ts`.
- Import and Export open `ImportExportDialog` from `settings/ImportExportSection.tsx`. No URL opens that dialog directly today.
- `lib/platform.ts` provides `isApplePlatform()` and `getPrimaryModifierLabel()`. `KeyboardShortcutsDialog.tsx` already shows Alt as ⌥ on Apple platforms.

## Constraints And Non-goals

- Web only. Nothing changes in Convex, the schema or the API.
- Add exactly one dependency, `cmdk@1.1.1`, pinned in `packages/ui/package.json`, and generate `components/ui/command.tsx` with the shadcn CLI (new-york).
- Matching is local and fuzzy, from cmdk, for Navigate and Actions. Cards are matched by the server search with a 200 ms debounce (`REMOTE_SEARCH_DEBOUNCE_MS`). The Cards query does not run until there are 2 characters.
- The palette lists no tags. You can still type `#tag` to find cards with that tag.
- No mobile entry button in this phase. It opens from a hardware keyboard only (for example an iPad), and must still lay out correctly at 390px.

## Backend

- None.

## Web

- `packages/ui/src/components/ui/command.tsx`: the shadcn Command primitives (`CommandDialog`, `CommandInput`, `CommandList`, `CommandGroup`, `CommandItem`, `CommandEmpty`).
- `packages/ui/src/components/command-palette/CommandPalette.tsx`: three groups. Folders show a folder or smart-folder icon, and long names are truncated with a `title`. The Cards group shows the card-type icon, the title (`lib/linkTitle.ts`) and the host.
- `packages/ui/src/lib/commandPalette.ts`: pure `isCommandPaletteKey(event)` and `shouldOpenPalette(event, root)`, built from `isTypingTarget`/`isOverlayOpen` but allowing plain inputs, so the search box doesn't block it. Also the static list of actions.
- `LibraryShortcuts.tsx`: mounts the palette and its listener next to the shortcuts dialog. Choosing Keyboard shortcuts closes the palette and then opens `?`, using the existing `afterCloseRef` pattern.
- `apps/web/src/components/AppShell.tsx`: passes in navigation, `handleNewNote` and sign out. Import and Export go to `/settings?dialog=import|export`, a new parameter that `ImportExportSection` reads once.
- `lib/keyboardShortcuts.ts`: add `{ keys: [mod, "K"], label: "Command palette", combo: true }` to Anywhere, showing ⌘ on Apple platforms and Ctrl elsewhere.

## API / MCP / SDK / CLI

- None.

## Docs

- `features.mdx`: a "Command palette" paragraph under "Keyboard shortcuts", and ⌘K added to the table.
- Ship-month changelog: "Jump anywhere with ⌘K".

## UI states

- **Empty:** with no input, Navigate and Actions are shown. A query with no matches shows "No results" in muted text. The Cards group is left out while the query is shorter than 2 characters.
- **Loading:** while cards load, the Cards group shows three one-line skeleton rows. Navigate and Actions never wait on it.
- **One / many items:** 0 folders hides the folder rows. 500 folders scroll inside the list, which is capped at 60vh. Cards are capped at 8, with a last row "Search all for "…"" that opens `/?q=`.
- **Very long names:** 300-character, emoji and RTL folder names truncate on one line (`dir="auto"`), and the tooltip shows the full name.
- **Error:** a failed card query shows "Couldn't search cards" in that group only. Navigate and Actions still work.
- **Rate-limited:** not applicable, because Convex queries are not rate-limited and keystrokes are debounced.
- **UI bar:** the dialog opens at about 20vh from the top, 640px wide (full width minus 16px at 390px), with a 150ms fade and scale. Keycaps sit right-aligned in `kbd`, and the copy is in sentence case.

## Scenario seed packs

- Reuse `folders-500`, `folders-ugly` and `tags-2000`. Add `palette-mixed`: 50 folders and 10 smart folders whose names are 300 characters, emoji, RTL, CJK, or differ only by case. Also 1,000 cards (from `ordering`) with marker titles, so one query has 0 results and another has more than 1,000.

## Break-it checklist

- **UI:**
  - ⌘K with the composer focused (should edit a link), in the card modal, with the shortcuts dialog open, with the bulk bar showing, and with the sidebar sheet open at 390px.
  - Type fast and press Esc before the results arrive: no stale results, and focus returns.
  - Enter on a card while its query is still loading.
  - Double Enter on Sign out.
  - Back after opening a card from the palette.
  - Open it in two tabs.
  - Go offline and type (cards show the error, navigation still works).
  - Keyboard only, with VoiceOver reading the group and option roles.
- **Backend:** not applicable. Check that the Cards group never shows trashed cards, and hides archived cards outside the Archive view, exactly like normal search.

## Tests

- `packages/ui/src/lib/__tests__/commandPalette.test.ts`: `test.each` over targets — an input opens it, `contenteditable` and a `defaultPrevented` event do not, an open menu does not, and Shift+⌘K does not.
- `packages/ui/src/components/command-palette/__tests__/CommandPalette.test.tsx` (`renderToStaticMarkup`): the groups render, the folder and smart-folder rows render, the Cards group is absent under 2 characters, and the error row renders.
- `packages/ui/src/hooks/__tests__/useKeyboardShortcuts.test.tsx`: existing; must stay green.
- `packages/tests/src/web/command-palette.e2e.ts`:
  - ⌘K opens it; typing a folder name and Enter navigates there.
  - Typing a marker title and Enter opens that card's modal.
  - ⌘K inside the composer opens link editing, not the palette.
  - Esc returns focus.

## Proof before the PR

- **Video:** a keyboard-only run: ⌘K, go to a folder, ⌘K, find a card and open it, Esc, ⌘K, Toggle theme, ⌘K, Shortcuts.
- **Video, worst case:** with 500 folders and fast typing, Esc mid-load, and ⌘K inside the editor.
- **Screenshots:** empty, loading, one result, many results, very long names, card error. Each in light and dark, at 390px and 1440px.

## Release gate

1. Run the narrow tests above, then the repo checks, plus `command-palette.e2e.ts`, `keyboard.e2e.ts` and `markdown-editor.e2e.ts`.
2. Seed `palette-mixed` and `folders-500`, run the break-it pass, then fix and add regression tests.
3. Send the proof bundle.
4. Open the PR; CI must be green. Merge and deploy the web app only. No backfill. Smoke-test production with ⌘K in Chrome, Safari and Firefox.

## Risks And Open Questions

- Some browsers bind Ctrl+K to the address bar (Chrome and Edge on Windows, Firefox). A page-level `preventDefault` wins while the page has focus, as it does on GitHub and Slack. Check this on Windows Chrome and on Firefox.
- `/settings?dialog=` is a new deep link. It must ignore unknown values and not stay in history after the dialog closes.
- The master plan says ⌘K is blocked only inside the text editor. This plan also ignores it while another dialog or menu is open, matching `isOverlayOpen` for every other shortcut. The owner should confirm that is acceptable inside the card modal.
