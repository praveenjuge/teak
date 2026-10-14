## Goal

Let people write in an existing text card full screen, with nothing on screen but the text. Today only new notes can open full screen. Phase 2 of the [roadmap v2](2026-10-14-roadmap-v2-00-roadmap.md).

## Depends on

- Nothing.

## Success Criteria

- A text card's modal has an "Focus" button (the `Maximize2` icon) that opens the card's editor full screen. A keyboard shortcut enters and leaves focus mode, and Esc leaves it.
- Focus mode shows one centered column (`max-w-3xl`) and nothing else. The Close and Save bar fades out while you type and comes back when you move the pointer or press a key outside the editor. The formatting toolbar still appears only when text is selected.
- A word count fades in at the bottom right after 1 second without typing, and fades out when typing starts. CJK text is counted correctly.
- Edits made in focus mode go into the card modal's unsaved changes and save the same way the modal does: Save, Cmd/Ctrl+Enter, or closing the modal. Leaving focus mode never throws away an edit.
- The new-note full-screen dialog keeps working exactly as before, through the same generalized component.

## Context And Current Facts

- `forms/FullScreenAddCardDialog.tsx` (92 lines) is a shadcn `Dialog` filling the screen (`h-dvh w-dvw`), with a Close and Save top bar and a `MarkdownTextEditor` in `max-w-3xl`. `forms/AddCardForm.tsx` is its only user (lines 119 and 287–322).
- The composer opens it with **Cmd/Ctrl+E**: the `Mod-e` keyboard shortcut in `RichMarkdownEditor.tsx` (lines 121–127) calls `onOpenFullScreen`, which is a prop on `MarkdownTextEditorProps` (`text-editor/types.ts`).
- A text card's editor in the modal is `card-previews/TextPreview.tsx`, used by `card-modal/CardModal.tsx` (`CardPreview`, lines 22–43). It wires `onContentChange` to `updateContent` and Cmd/Ctrl+Enter to `saveChanges`. TextPreview *is* the modal's editor, so "open from the text preview and the card modal" is a single entry point.
- Saving goes through `useCardModal` (`hooks/useCardModal.ts`): `pendingChanges.content` is written with `api.cards.updateCardField({ field: "content" })`. `CardModal.handleClose` saves any unsaved changes when the modal closes. A "Save changes" button shows while `hasUnsavedChanges` is true.
- Notes are capped at 512 KiB (`MARKDOWN_CONTENT_MAX_BYTES`, `shared/markdown.ts`). `prepareMarkdownDocument` (`text-editor/markdownDocument.ts`) falls back to one `literalMarkdown` block for content it can't round-trip: tables, front matter, reference links, and anything over the cap.
- The formatting bubble (`EditorControls.tsx`, `shouldShow`) already shows only for a non-empty selection, and never in code blocks or literal Markdown.

## Constraints And Non-goals

- Web and the shared UI only. No change to the backend, the API or the native apps.
- Generalize `FullScreenAddCardDialog` into `FocusEditor` (`packages/ui/src/components/text-editor/FocusEditor.tsx`), and turn `FullScreenAddCardDialog` into a thin wrapper around it so that `AddCardForm` and its tests don't change.
- **Shortcut:** Cmd/Ctrl+E (the existing `Mod-e`) enters focus mode from the modal and leaves it from inside. The approved plan proposed ⌘⇧F; see Risks.
- Only text cards. Quote cards stay out of scope.
- No typewriter scrolling, no themes and no fonts (reader themes were rejected).

## Backend

- None.

## Web

- `text-editor/FocusEditor.tsx`:
  - Props: `value`, `onChange`, `onSave`, `onRequestClose`, `canSave`, `placeholder`, `title` (screen-reader title) and `saveLabel`.
  - It renders the existing full-screen `DialogContent` with a fading chrome bar and a `WordCount`.
  - Esc closes only the focus dialog: Radix closes the top-most dialog, and the card modal underneath stays open.
- `text-editor/wordCount.ts`: a pure `countWords(markdown)` that uses `markdownToPlainText` (`lib/markdownToPlainText.ts`) and `Intl.Segmenter` with `granularity: "word"`, counting segments where `isWordLike` is true.
- `card-previews/TextPreview.tsx`: passes `onOpenFullScreen`. It owns the focus state and renders `FocusEditor` with `getCurrentValue("content")`, `onContentChange` and `onSaveShortcut`.
- `card-modal/CardModal.tsx`: a ghost icon button "Focus" in the text preview's top-right corner, with tooltip "Focus (⌘E)".
- `forms/FullScreenAddCardDialog.tsx`: delegates to `FocusEditor`.

## API / MCP / SDK / CLI

- None.

## Docs

- `features.mdx`: a sentence under the notes and editing text on focus mode and ⌘E.
- The ⌘E row in the shortcut table, if it isn't there yet.
- Ship-month changelog: "Write existing notes in focus mode".

## UI states

- **Empty:** an empty text card shows the placeholder "Write a note…" and a word count of "0 words", which stays hidden until the editor has been idle.
- **Loading:** the card is already loaded when the modal opens, so focus mode has no loading state. The editor mounts with `immediatelyRender: false`, so render nothing rather than a spinner for that frame.
- **One / many items:** a 50,000-word note scrolls inside the column. The count shows "50,000 words" (formatted with `Intl.NumberFormat`).
- **Very long content:** a note in literal Markdown (tables, over the cap) opens as a literal block. Focus mode still works, and there is no formatting bubble.
- **Error:**
  - Going over 512 KiB shows the existing "Notes can be up to 512 KiB of UTF-8 text" toast.
  - A failed save keeps focus mode open and shows the modal's existing error toast.
- **Rate-limited:** not applicable.
- **UI bar:** the chrome fades out over 200ms ease-out and comes back on `pointermove`. The word count uses tabular numbers in `text-muted-foreground`. The writing column is padded 16px at 390px.

## Scenario seed packs

- `focus-notes`: four text cards:
  - a 50,000-word note (about 300 KB, under the cap)
  - a note made of code blocks and Markdown tables (it opens as literal Markdown)
  - an empty note
  - a CJK and RTL note
- Also a 300-character-title text card from the v1 ugly-data pack.

## Break-it checklist

- **UI:**
  - Two tabs editing the same note.
  - Reload while focus mode has unsaved text (the browser's `beforeunload` is not added; the edit is lost, as in the modal today — check that it's the same).
  - ⌘E while the slash menu is open (the menu keeps Esc; ⌘E toggles focus).
  - Esc while the link editor is open (closes the link editor first).
  - Double-click Focus.
  - Leave and re-enter during a save.
  - Resize from 1440px to 390px.
  - Light and dark.
  - Keyboard only: Tab must not escape the dialog.
- **Backend:** an edit saved from focus mode must equal an edit saved from the modal. `updateCardField` stays idempotent, and two quick saves keep the last.

## Tests

- `packages/ui/src/components/text-editor/__tests__/wordCount.test.ts`: `test.each` with English, CJK (no word breaks), Markdown syntax that isn't counted, code blocks, emoji and an empty string.
- `packages/ui/src/components/text-editor/__tests__/FocusEditor.test.tsx` (`renderToStaticMarkup`): the Save button is disabled when `canSave` is false, the screen-reader title is there, and the word count is there.
- `packages/ui/src/components/forms/__tests__/AddCardForm.test.tsx`: existing; must stay green.
- `packages/tests/src/web/focus-mode.e2e.ts`:
  - Open a text card, press ⌘E, type, press Esc. The modal shows "Save changes".
  - Press Cmd+Enter: the saved content shows in the grid.
  - ⌘E on the composer still opens the new-note dialog.

## Proof before the PR

- **Video:** open a note, Focus, write, watch the chrome fade and the count appear, Esc, Save.
- **Video, worst case:** the 50,000-word note, ⌘E with the slash menu open, and two tabs.
- **Screenshots:** empty, normal, 50k words, literal Markdown, over-limit toast. Each in light and dark, at 390px and 1440px.

## Release gate

1. Run the narrow tests, then the repo checks, plus `focus-mode.e2e.ts`, `markdown-editor.e2e.ts` and `composer-and-settings.e2e.ts`.
2. Seed `focus-notes`, run the break-it pass, then fix and add regression tests.
3. Send the proof bundle.
4. Open the PR; CI must be green. Merge and deploy the web app only. No backfill. Smoke-test production with a real note.

## Risks And Open Questions

- **Shortcut.** The approved plan named ⌘⇧F. The code already uses ⌘E (`Mod-e`) for full screen in the composer, and ⌘⇧F is taken by some browsers and OS full-screen bindings. This plan uses ⌘E for consistency. The owner should confirm.
- **Two tabs.** Last write wins: there is no conflict detection today. That is unchanged, but focus mode makes long edit sessions more likely. A "changed elsewhere" notice could come later.
