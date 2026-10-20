## Goal

Let people highlight passages while reading a saved article in Teak, and keep a short note on any highlight. Highlights are their own records, in one calm color. They are listed in the card's side panel, where clicking one jumps to it in the reader. They can be read and written through the API, MCP, SDK and CLI, and they come in from Instapaper and Omnivore imports as real highlights instead of note text. Phase 12 of the [roadmap v3](2026-10-19-roadmap-v3-00-roadmap.md).

## Depends on

- [Phase 10](2026-10-19-roadmap-v3-10-reader-view.md): you highlight in the Read tab, against the article Markdown that phase 10 extracts.
- [Phase 9](2026-10-19-roadmap-v3-09-page-archive.md): once a card has highlights, its archive is frozen.

## Success Criteria

- **Making a highlight.**
  - On desktop, selecting text in the Read tab shows a small floating button above the selection: **Highlight** (lucide `Highlighter`, with a `H` hint). Clicking it, or pressing `H` while the selection is active, creates the highlight optimistically.
  - On touch, and at 390px, a bottom bar appears instead, because the native selection menu covers the top.
  - The passage is painted in the single highlight color.
- **Notes and removal.**
  - Clicking a highlight opens a popover. It has a note field (placeholder "Add a note", up to 2,000 characters, saved on blur or ⌘↵) and a **Remove highlight** button, whose toast offers Undo.
  - On touch, the same controls open in a bottom drawer.
- **Overlaps.** A new highlight that overlaps an existing one merges into it: the result spans both, and the older note is kept. A highlight can be at most 5,000 characters; past that the toast says "Highlights can be up to 5,000 characters". A card can have at most 200 highlights.
- **The side panel** gets a **Highlights** section when a card has any. Its title is "Highlights · 4".
  - Each item shows the quote, clamped to 3 lines with a 2px left rule in the highlight color, and its note below in muted 13px.
  - Clicking an item switches the modal to Read (phase 10's toggle), scrolls to the passage and flashes it once (200 ms).
  - A highlight that can't be placed in the article shows "Not found in the saved article". It can't be clicked, and can still be removed.
- **Freezing.** Once a card has any highlight (`cards.hasHighlights`), its archive and article are frozen:
  - Refresh details still refreshes the metadata and AI, but skips "archive page" and "extract article";
  - a re-save with a new extension snapshot doesn't replace the archive.
- **Imports.**
  - Instapaper's `Selection` column and Omnivore's `highlights/<slug>.md` blocks create highlight records instead of filling `notes`.
  - They start unanchored, and are anchored automatically once the card's article is extracted.
  - The Teak archive ZIP export and import round-trip highlights.
- **API, MCP, SDK and CLI** can list, create (by quote), change the note of, and delete highlights. Serialized cards gain `highlightCount`. Account export's `cards.json` gains `highlights`.
- **Not searchable.** The owner chose the side panel as the only place they show up outside the reader. No Highlights page, and no tile badge.
- **Native apps keep working.** They ignore the new fields.

## Context And Current Facts

- **The reader** (phase 10) renders the article Markdown with `react-markdown` inside an `ArticleReader` root. Its text comes from `article.textKey` (`.../article-text/<sha256>.md`), and the reader is the only place article text is shown.
- **Side panel:** `CardMetadataPanel.tsx` builds sections with `PanelSection`:
  - "Linked from" (142), "Notes" (264), "Summary" (288), "Tags" (323), "Colors" (405), "Details" (422).
  - The modal hands it `onOpenCard`, the backlinks and the edit callbacks (`CardModal.tsx:835-850`).
- **Modal shortcuts** are listed in `apps/web/src/lib/keyboardShortcuts.ts:40-48`. Phase 10 adds `R`, and `H` is still free.
- **How imports handle highlights today:**
  - Instapaper puts `Selection` into `notes` (`packages/convex/import/instapaper.ts:30-58`, line 50).
  - Omnivore puts the `highlights/<slug>.md` Markdown into `notes` (`packages/convex/import/omnivore.ts:47-71`, read by `apps/files-worker/src/archives/importOmnivore.ts:154-175`).
  - Readwise Reader's library CSV (`import/readwise.ts:28-31`) has no highlight column (`Title, URL, ID, Document tags, Saved date, Reading progress, Location, Seen`), so it has no highlights to import.
  - One other supported bookmark CSV source documents a `highlights` column, which its parser ignores today.
- **Import pipeline:**
  - `ImportCardInput` (`packages/convex/import/validate.ts:39-53`) has `notes` but no highlights.
  - `linkItem` (`import/sourceItems.ts:80-108`) caps notes at `MAX_NOTES_LENGTH`.
- **Card writes:**
  - Per-card derived rows are removed when a card is gone in `searchDocumentHelpers.ts:280-299`, for example `deleteCardTextRow`, the linked-PDF rows and the card-link cleanup.
  - In account deletion they are removed in `accountDeletion.ts:120-140` and `accountDeletionData.ts` `ancillaryPage` (87).
- **Refresh details** calls `queueCardProcessing(ctx, cardId, { refresh: true, reset: true })` (`card/updateCard.ts:640-656`).
- **Export:** `export/serialize.ts serializeCard` lists the exported fields, and `getExportCardsPage` (`dataExport.ts:446`) reads them.
- **Painting without touching the DOM:** the CSS Custom Highlight API (`CSS.highlights`, `::highlight()`) paints ranges without changing it, which suits a React-rendered tree. It ships in current Chrome, Safari 17.2+ and Firefox 140+, which are the extension's minimum browsers too.

## Constraints And Non-goals

- **Reader only.** No highlighting on live pages, in PDFs, in notes or in the archive viewer (owner decision). One color, not a palette.
- **Anchoring** follows the W3C Web Annotation selectors. Each highlight stores:
  - a **TextQuote**: `quote`, plus `prefix` and `suffix` of 32 characters each;
  - a **TextPosition** hint: `start` and `end`, offsets into the article's normalized plain text (whitespace collapsed, as the reader's `textContent`);
  - `articleKey`, the `textKey` it was made against.

  Re-anchoring searches for the quote with its context, uses the offset hint to choose between repeats, and falls back to whitespace-insensitive matching. Because the article is frozen once highlighted, anchors only fail for imported or API-made highlights whose quote isn't in the extracted text.
- **Painting** uses `CSS.highlights.set("teak-highlight", new Highlight(...ranges))` and a `::highlight(teak-highlight)` rule. The React tree is never wrapped in `<mark>`. Clicks are hit-tested with `document.caretPositionFromPoint` (or `caretRangeFromPoint`) against the stored ranges.
- **Color tokens** in `apps/web/src/styles/theme.css`, each checked to keep body text at AA contrast:
  - `--highlight`: light `oklch(0.94 0.11 95)`, dark `oklch(0.42 0.08 85 / 0.6)`;
  - `--highlight-active`: a step stronger, for the flash and the open popover.
- **Not searchable, not embedded.** Highlight text doesn't enter `cardSearchDocuments` or the embedding text.
- **Analytics:** add `highlight_created { source: "reader" | "api" | "import", merged }`, `highlight_note_saved` and `highlight_removed` to `shared/analytics.ts` first.

## Backend

- **`schema.ts`, new table `highlights`:**
  - Fields: `{ userId, cardId, quote, prefix?, suffix?, start?, end?, articleKey?, note?, unanchored?: v.optional(v.literal(true)), source: "reader" | "api" | "import", createdAt, updatedAt }`.
  - Indexes: `by_cardId_and_createdAt` and `by_userId`.
- **On `cards`:** `hasHighlights: v.optional(v.literal(true))` and `highlightCount: v.optional(v.number())`, kept in step by every highlight write in the same mutation. Each write also bumps `updatedAt` so `/v1/cards/changes` reports the card.
- **`highlight/highlights.ts`:**
  - **`listForCard`** (query, owner only) returns the highlights in article order (by `start`, with unanchored ones last).
  - **`create`** `{ cardId, quote, prefix?, suffix?, start?, end?, note? }`:
    - The card must be a link, not trashed, with `article.status === "ready"`. Otherwise it fails with `NO_ARTICLE`.
    - It enforces the caps: 200 per card, a quote of 5,000 characters at most, a note of 2,000 at most.
    - An overlap with existing `start`/`end` merges into the overlapping highlight (the union of their ranges; the quote and context are recomputed by the client and sent; the older note is kept).
    - It is idempotent on `(cardId, start, end)`.
  - **`updateNote`** `{ highlightId, note | null }`.
  - **`remove`** `{ highlightId }`. Undo calls `create` with the stored selectors.
  - **Rate limit:** a new `highlightWrites` bucket of 120 per minute.
- **`highlight/anchor.ts` `anchorQuote(plainText, { quote, prefix?, suffix?, start? })`** returns `{ start, end, prefix, suffix } | null`. It is a pure function shared by the server and the web (`packages/convex/shared/highlights/anchor.ts`), and is table-tested.
- **`highlight/anchorPending.ts`:** after phase 10's `saveArticleText` writes a ready article, it schedules an action that:
  - reads the article Markdown;
  - converts it to plain text with the same `markdownToReaderText` used by the web (a shared helper);
  - anchors every unanchored highlight of the card, clearing `unanchored` and filling the offsets.

  The highlights that don't match stay unanchored.
- **Freeze** (`run.ts` and Convex):
  - "archive page" and "extract article" skip when `card.hasHighlights` and the run is a refresh or a re-save;
  - `createCard`'s re-save path (phase 3) drops a new `pageSnapshotKey` for highlighted cards and queues its object for deletion.
- **Imports:**
  - `ImportCardInput` gains `highlights?: Array<{ quote: string; note?: string }>`, with at most 200 and the same caps, validated in `validateImportCard`.
  - **Instapaper:** a non-empty `selection` becomes `highlights: [{ quote: selection }]`, and `notes` is no longer set from it.
  - **Omnivore:** a new `parseOmnivoreHighlights(markdown)` splits the file into `> quote` blocks; the lines after each block, up to the next quote, are its note. The Markdown no longer goes to `notes`.
  - The import insert writes highlight rows with `unanchored: true, source: "import"` beside the card.
  - Teak archive import restores `highlights` from `cards.json`, unanchored, and anchors them after extraction.
- **Deletion:**
  - card hard delete removes the highlight rows, in the `searchDocumentHelpers.ts` gone-card cleanup, behind `previousCard?.hasHighlights`;
  - account deletion pages over `highlights.by_userId` in `ancillaryPage` and in `accountDeletion.ts`. Its batch's `length > 0` joins `ancillaryPage`'s continuation return (`accountDeletionData.ts`, the `return (cardLinks.length > 0 || …)` near line 202), so more than one page of rows is deleted; the test seeds more than 100 rows.
  - the "complete stages" test seeds highlight rows.
- **Export:** `serializeCard` adds `highlights: [{ quote, note, createdAt, anchored }]` to `cards.json`, and `cards.csv` gains a `highlights` column, with the quotes joined by a blank line.

## Files Worker

- **`run.ts`:** in "archive page" and "extract article", read `hasHighlights` from the loaded card and return `{ status: "skipped", reason: "frozen" }` on refresh and re-save runs. The steps keep their names, and no new step is added.
- **`importOmnivore.ts`:** unchanged. It still reads the highlights file, and the Convex parser now splits it.

## Web

- **`card-previews/ArticleReader.tsx`:**
  - **Data:**
    - it takes the `highlights` prop from `useQuery(api.highlight.highlights.listForCard)`;
    - after the Markdown renders, it builds a text-node index of the reader root;
    - it anchors each highlight through `anchorQuote`, mapping plain-text offsets to DOM `Range`s;
    - it paints them with the Custom Highlight API.
  - **Selection:**
    - it listens to `selectionchange` and `pointerup` inside the root;
    - for a non-collapsed selection inside the root, it computes offsets into the normalized text and shows `HighlightSelectionButton`, a small `Button size="sm" variant="secondary"` positioned 8px above the selection's last client rect and kept inside the column;
    - `H` creates the highlight while the button shows, and `Esc` hides it;
    - selections that span the reader header or footer are clipped to the article body.
  - **Touch** (`pointerType === "touch"` or narrower than 768px): a fixed bottom bar, `h-12`, with safe-area padding and a single "Highlight" button.
  - **Clicking a highlight:**
    - a hit-test on `pointerup` with no selection opens `HighlightPopover` (a shadcn `Popover` anchored to a virtual element at the range's rect);
    - it holds a `Textarea` (3 rows, autosizing, a counter appearing past 1,800), a "Remove highlight" ghost button with a trash icon, and closes on `Esc`;
    - on touch it is a `Drawer` holding the same controls.
  - **Jump:** an imperative `scrollToHighlight(id)` scrolls the range into view (`block: "center"`) and swaps in `--highlight-active` for 200 ms. It honours `prefers-reduced-motion`, so there is no smooth scroll.
- **`card-modal/CardMetadataPanel.tsx`:** a new `PanelSection title="Highlights · N"` right after Notes, only when there are highlights.
  - Items are `<button>`s with the quote in `line-clamp-3`, `border-l-2 border-[--highlight] pl-3`, and the note below in muted text.
  - A ⋯ on hover or focus offers "Remove".
  - Clicking calls `onJumpToHighlight(id)`, which the modal wires to set the Read view and then `scrollToHighlight`.
  - Unanchored items have no hover state and a muted "Not found in the saved article" line.
- **`keyboardShortcuts.ts`:** add `{ keys: ["H"], label: "Highlight the selection" }` to the Card group.
- **Optimistic updates:** create, note and remove patch the query's local result, and roll back with "Couldn't save the highlight. Try again." on error.

## API / MCP / SDK / CLI

- **Routes** (in `http.ts`, with `OPTIONS`):
  - `GET /v1/cards/{cardId}/highlights` returns `{ items: Highlight[] }`, where a `Highlight` is `{ id, cardId, quote, note, anchored, source, createdAt, updatedAt }`.
  - `POST /v1/cards/{cardId}/highlights` takes `{ quote, note?, prefix?, suffix? }`. The server anchors the quote in the article's plain text, taking the first match unless `prefix` or `suffix` narrows it. It returns 201, or:
    - 409 `NO_ARTICLE` when the card has no extracted article;
    - 422 `QUOTE_NOT_FOUND`;
    - 409 `HIGHLIGHT_LIMIT` past 200.
  - `PATCH /v1/highlights/{highlightId}` takes `{ note: string | null }`.
  - `DELETE /v1/highlights/{highlightId}` returns 204.
  - Another user's ids return 404.
- **Error codes:** `NO_ARTICLE`, `QUOTE_NOT_FOUND` and `HIGHLIGHT_LIMIT` go in `PUBLIC_API_ERROR_CODES` and in the SDK's `ERROR_CODES`.
- **Serializers** add `highlightCount: number`.
- **MCP:** `teak_v1_list_highlights`, `teak_v1_create_highlight`, `teak_v1_update_highlight`, `teak_v1_delete_highlight`.
- **SDK:** `highlights.list(cardId)`, `highlights.create(cardId, input)`, `highlights.update(id, { note })`, `highlights.delete(id)`.
- **CLI:**
  - `teak highlights list <cardId>`
  - `teak highlights add <cardId> "<quote>" [--note …]`
  - `teak highlights note <id> "<text>" | --clear`
  - `teak highlights rm <id>`

  Each has `--json`.
- **`scripts/public-parity.ts`:** four rows.
- **`.agents/skills/teak`:** document the commands.

## Docs

- **`features.mdx`:** a "Highlights" subsection covering how to highlight (select text, then the button or `H`), notes, the side panel, and "highlighted articles keep their saved copy".
- **`(data)/import.mdx`:** Instapaper and Omnivore highlights now arrive as highlights.
- **`api.mdx`, `mcp.mdx`, `(apps)/cli.mdx`:** the new operations and errors.
- **Changelog:** "Highlight what you read".

## UI states

- **No highlights:** no panel section and no hint in the reader. Discovery comes from the selection button.
- **One, or many:** the panel lists them in article order. At 200 the selection button is disabled, with the tooltip "This card has 200 highlights, the most it can hold".
- **Long quote or long note:** clamped in the panel. The popover's textarea scrolls after 8 rows.
- **Anchoring in progress** (imported, article still extracting): the panel lists the quotes with a muted "Waiting for the article…" line.
- **Failed write:** the highlight is removed again, with an error toast.
- **Rate-limited:** "Too many changes. Try again in a moment."
- **Overlap merge:** the toast reads "Merged with an existing highlight".
- **Light and dark:** both highlight tokens are checked. Selected text inside a highlight still shows the system selection on top.
- **390px:** the bottom bar and drawer, and the panel sits below the reader as the modal stacks.

## Scenario seed packs

- `highlights-mix`, on `reader-mix` cards:
  - an article with 1 highlight, one with 12 (some with notes, one with a 2,000-character note), one with 200 (the cap);
  - overlapping requests;
  - a quote repeated three times in the article;
  - RTL and CJK highlights;
  - three unanchored imported highlights (one never matches);
  - a highlighted card set up for a refresh, to prove the freeze.
- `highlight-imports`: an Instapaper CSV with 50 selections and an Omnivore ZIP with 20 highlight files (notes included, one malformed).

## Break-it checklist

- **Selection:**
  - a selection across a heading and a list;
  - a selection that includes the reader header;
  - a selection inside a table cell;
  - double-click and triple-click selection;
  - selecting and pressing `H` twice quickly (one highlight);
  - highlighting while the article reloads from cache;
  - two tabs highlighting the same passage (the merge is idempotent).
- **Notes and undo:**
  - save a note, then reload mid-save;
  - remove, undo, then remove again;
  - Undo after the modal has moved to the next card.
- **Behaviour across views:**
  - keyboard only: Tab to panel items, Enter jumps;
  - screen reader: highlights have no live DOM, so the panel list is the accessible view (check the announcements);
  - 390px with the iOS selection menu, and Android Chrome.
- **Backend:**
  - the caps, another user's ids, a trashed card, a card with no article;
  - `QUOTE_NOT_FOUND` with a quote that has curly instead of straight quotes (normalized match);
  - Refresh details on a highlighted card keeps the archive and article keys unchanged;
  - a re-save with a snapshot on a highlighted card;
  - an import into an account over the card cap, where the highlights go with their card.
- **Deletion:** a hard-deleted card's highlights are gone, and account deletion removes them all.

## Tests

- `packages/convex/__tests__/shared/highlights/anchor.test.ts`: exact match, context disambiguation, offset hint, whitespace and quote normalization, not found, RTL and CJK.
- `packages/convex/highlights.test.ts` (convex-test, add to `vitest.config.ts`):
  - create, merge, cap, note, remove;
  - `hasHighlights` and `highlightCount` stay in step;
  - `updatedAt` bump;
  - ownership;
  - `NO_ARTICLE`;
  - anchoring of pending highlights after the article is saved.
- `packages/convex/__tests__/import/instapaper.test.ts` and `omnivore.test.ts`: highlights instead of notes; Omnivore notes split.
- `packages/convex/__tests__/export/serialize.test.ts`: `highlights` in JSON and CSV. The archive import round-trip test.
- `packages/convex/accountDeletionWorkflow.test.ts`: seed highlight rows.
- `apps/files-worker/src/workflows/cardProcessing/run.test.ts`: the frozen skip on refresh and re-save.
- `packages/convex/__tests__/publicApiHttpCards.test.ts` (or a new `publicApiHttpHighlights.test.ts`), `__tests__/mcp.test.ts`, `__tests__/sdk.test.ts`, and `apps/cli/src/commands.test.ts`.
- `apps/web/src/components/card-previews/__tests__/ArticleReader.test.tsx`: offsets from a selection map to the right plain-text range (pure helper); the selection button renders for a selection inside the body.
- `apps/web/src/components/card-modal/__tests__/CardMetadataPanel.test.tsx`: the section appears only with highlights; unanchored items aren't buttons.
- e2e:
  - `packages/tests/src/web/highlights.e2e.ts` selects a sentence in the reader, presses `H`, sees "Highlights · 1" in the panel, adds a note, reloads, and the note is still there;
  - `journey/03-api.e2e.ts` and `04-cli.e2e.ts` create a highlight by quote and list it.

## Proof before the PR

- **Video 1:** read an article, highlight two passages (one with the button, one with `H`), add a note, then jump to each from the side panel.
- **Video 2:** an Instapaper import whose highlights start as "Waiting for the article…" and then anchor. Then Refresh details on that card, and the highlights stay in place.
- **Screenshots:**
  - the selection button;
  - the note popover;
  - the touch bottom bar and drawer;
  - the panel with 1, with 12, and with unanchored items;
  - the 200 cap.

  Each in light and dark, at 390 and 1440 px.
- **Captured output:** the four API operations and the CLI commands.

## Release gate

1. Run the narrow tests, then the repo checks and the e2e specs listed.
2. Seed `highlights-mix` and `highlight-imports`, run the break-it pass, then fix and add regression tests until it comes back clean.
3. Send the proof bundle to the owner.
4. Merge, then deploy the Files Worker (the freeze check), then Convex and web. There is no backfill: old notes from past imports stay as they are (owner decision).
5. Smoke-test production by highlighting an article on the web and listing it with `teak highlights list`.

## Risks And Open Questions

- **Plain text on the server and in the DOM may differ.** The server's plain text (from Markdown) and the browser's `textContent` can differ around lists, tables and images. The shared `markdownToReaderText` helper must produce what the reader renders. A test renders each fixture with `react-markdown` and compares its text with the helper's.
- **Readwise.** The Readwise Reader library CSV has no highlights. Open decision (default: no change in v3). Readwise's separate highlights CSV would be a new import source.
- **The ignored `highlights` column.** One existing bookmark CSV source has a `highlights` column that is ignored today. Open decision (default: map it to highlights in this phase, since it is a small parser change).
- **Overlap behaviour.** Open decision (default: merge into one). The alternative is to refuse the overlap.
- **Freezing blocks article improvements.** A better extractor later won't reach highlighted cards. Open decision (default: frozen, as decided). A future "Re-extract and re-anchor" could offer it with a warning.
- **Custom Highlight API support.** Browsers without it (older Safari) get highlights listed in the panel but not painted in the reader. Detect this, and show "Your browser can't show highlights in the text" once.
