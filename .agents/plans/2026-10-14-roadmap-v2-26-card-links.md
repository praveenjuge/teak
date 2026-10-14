## Goal

Let people link cards from inside a note. Typing `[[` offers matching cards, and the link is stored as `[[Title|teak:<cardId>]]`. It renders as a pill with the target's current title, so links survive renames, and clicking the pill opens the card. Phase 26 of the [roadmap v2](2026-10-14-roadmap-v2-00-roadmap.md).

## Depends on

- Nothing in v2. Phase 27 adds the backlinks panel and the API on top of this.

## Success Criteria

- In the text editor (the card detail and the add form), `[[` opens a suggestion list:
  - up to 8 of the user's cards, matching the typed text
  - arrow keys, Enter and Esc work as in the slash menu
  - the card being edited is excluded
- Choosing a card inserts a pill. Saving writes `[[<title at insert time>|teak:<cardId>]]` into the Markdown.
- Pills always show the target's **current** title.
  - Clicking a pill, or pressing Enter on a focused one, opens that card (`?card=<id>`).
  - A link to a trashed, deleted or foreign card shows a muted "Missing card" pill that does nothing.
  - Restoring the target from Trash brings its pill back.
- A `cardLinks { userId, fromCardId, toCardId }` table mirrors the tokens in each text card's content. It's rebuilt after every content save from any surface: web, API, MCP, CLI or native.
- Hard-deleting a card removes its rows in both directions. Account deletion removes all of the account's rows.
- Grid tiles, native previews and search show the link's title, not the raw token.

## Context And Current Facts

- **Editor.** The rich editor is `RichMarkdownEditor.tsx`. It wires editorcn's `SlashCommand` with `@tiptap/suggestion`:
  - plugin key `teakSlashCommands`
  - `render` handles `onStart`/`onUpdate`/`onExit`/`onKeyDown` with arrows, Enter and Esc
  - `SlashMenu.tsx` renders a `fixed` listbox positioned by `@floating-ui/dom`, with `aria-activedescendant`
- **Document extensions.** `markdownDocument.ts` `documentExtensions()` returns StarterKit, `LiteralMarkdown`, `TaskList` and `TaskItem`.
  - A note opens as rich blocks only when `hasSameMarkdownMeaning` (a `marked` GFM token comparison) holds. Anything else becomes literal text.
  - `[[…]]` is plain text to `marked` today.
- **Editor rules.** The Tiptap packages are pinned to 3.31.4 and `@editorcn/block-editor` to 0.2.0 (`text-editor/README.md`). The README forbids silent rewrites: "Opening or selecting a note never rewrites its string."
- **Where the editor is used.** Text card content (`card-previews/TextPreview.tsx`, `forms/AddCardForm.tsx`, `forms/FullScreenAddCardDialog.tsx`). Notes use a plain `Textarea` (`modals/NotesEditModal.tsx`), so links live in text card content only.
- **Content saves.**
  - `updateCard` (`card/updateCard.ts:178`) patches content and calls `scheduleCardSearchSync`.
  - `updateCardFieldsForUserHandler` (the `"content"` edit, used by `updateCardField` and the public API) does the same.
  - `createCardForUserHandler` creates text cards.
- **Hard delete** happens in `card/deleteCard.ts` (`permanentDeleteCardForUserHandler`) and `workflows/cardCleanup.ts` (`cleanupDeletedCard`). Account deletion pages cards through `deleteAccountDataHandler` (`accountDeletion.ts:308`), then sweeps per-user tables in `accountDeletionData.ts ancillaryPage`.
- **Titles.** The display-title rule (link preview title, then `metadataTitle`, then file name, then host, then first line, then "Saved card") lives only inside `toMobileCardSummary` (`card/mobileCardSummaries.ts:74`). Its `previewText` is `compactText(card.content)`, so the raw token would reach native tiles.
- **Search text** is built from `SEARCH_FIELDS` (content, notes, …) in `card/searchDocumentHelpers.ts`.
- **Web routing.** The web opens a card from `?card=<id>` (`apps/web/src/app/HomePageClient.tsx:32`).
- **Export.** `export/serialize.ts` exports `content` verbatim with each card's `id`, so tokens stay meaningful in an export.

## Constraints And Non-goals

- **Token grammar.**
  - Pattern: `\[\[([^\]\|\n]{0,200})\|teak:([a-z0-9]{16,64})\]\]`. A title's `|`, `]` and newlines are replaced with spaces when the token is written. It is then cut to at most 200 characters, ending on a whole grapheme with `…` appended, because card titles can be up to 512 characters and the grammar accepts 200. The stored title is only a readable fallback: the pill always shows the target's current full title, and the link itself is the id.
  - Tokens inside code spans and blocks are not links.
  - At most 500 distinct targets per card are indexed. Later ones render, but they're not stored.
- Links are made only to the user's own cards. A foreign or unknown ID never creates a row and renders as missing.
- Parsed IDs are normalized before any lookup. The grammar accepts any 16–64 character lowercase string, which is broader than the set of valid Convex IDs, and tokens can arrive from the API, MCP, CLI, imports or pasted Markdown. Each value goes through `ctx.db.normalizeId("cards", value)`, and `null` is treated as missing. It is never passed to a validator or `ctx.db.get` as-is, so one malformed token never fails the whole link sync or target query.
- Self-links are ignored (no row), and so are duplicates.
- **Link rows sync after the save.** Saves schedule `syncCardLinks` (`ctx.scheduler.runAfter(0)`), as the search sync does. The rebuild reads the current content, so it's idempotent and the last write wins.
- No rewriting of stored titles on open or save. A token's title refreshes only when its pill is re-inserted. Display always uses the live title.
- Native apps render pills read-only in phases 29 and 31. Until then they show the title (the server-side preview text below).
- Rows are added to account deletion and both hard-delete paths. There are no R2 keys.

## Backend

- `shared/cardLinks.ts` (pure, shared with web and native ports):
  - `CARD_LINK_PATTERN`
  - `parseCardLinkIds(markdown)` returns IDs: ordered, unique, max 500, with code excluded
  - `formatCardLinkToken(title, id)`: sanitizes and truncates the title as above, so every token it produces matches the parse pattern
  - `replaceCardLinkTokens(markdown, (title, id) => string)`
- `card/displayTitle.ts`: `cardDisplayTitle(card)`, extracted from `toMobileCardSummary`. The summary function then uses it.
- `schema.ts cardLinks { userId, fromCardId: v.id("cards"), toCardId: v.id("cards"), createdAt }`, with `by_fromCardId_and_toCardId`, `by_toCardId` and `by_userId`.
- `card/cardLinks.ts`:
  - `syncCardLinks` (internal mutation):
    - loads the card; when it's not a text card, or it's gone, deletes its outgoing rows
    - otherwise parses the IDs, keeps those owned by the user that are not the card itself, and diffs against the existing rows (insert or delete)
  - `scheduleCardLinkSync(ctx, cardId)`, called from `updateCard`, the `"content"` edit in `updateCardFieldsForUserHandler` and `createCardForUserHandler` (text cards).
  - `deleteCardLinksForCard(ctx, cardId)` deletes both directions, 500 per call, and schedules itself again while more remain. It's called from `permanentDeleteCardForUserHandler` and `cleanupDeletedCard`.
  - Session query `getCardLinkTargets({ cardIds })`, max 500: returns `[{ id, title, type, missing }]`, with `missing` for trashed, deleted or foreign targets. It's re-exported from `cards.ts` as `cards:getCardLinkTargets` (also used by phase 29).
  - Session query `searchCardLinkSuggestions({ query, excludeCardId })`: 8 results from `cardSearchDocuments.search_searchableText` with the user's filter, excluding trashed cards and phase 4's hidden cards (`isHidden`). A hidden card is offered only when the suggestion query itself contains a revealing tag (`#private`, `#nsfw`, `#hidden`), the same rule as library search, so typing `[[` in an unrelated note never exposes a hidden card's title. `getCardLinkTargets` still resolves an existing link to a hidden card, because the user created that link knowingly. An empty query returns recent cards (`by_user_deleted_archived_created`). Returns `[{ id, title, type }]`.
- `accountDeletionData.ts ancillaryPage`: delete 100 `cardLinks` rows per page through `by_userId`.
- `toMobileCardSummary`: `previewText` replaces each token with its stored title, so old native builds show text. The same applies to the web tile preview.
- `buildCardSearchText` indexes the token's title and drops the `teak:<id>` part.
- No backfill: no existing content has tokens.

## Web

- `text-editor/CardLinkNode.ts`: an inline atom node `cardLink { cardId, title }`, with:
  - a `@tiptap/markdown` tokenizer and serializer for the token
  - a node view rendering a `Badge`-style pill with the type icon, the live title from context, and a "Missing card" state
- Add it to `documentExtensions()`, so `prepareMarkdownDocument` keeps notes with tokens rich. `hasSameMarkdownMeaning` holds because the node serializes back to the exact token.
- `text-editor/CardLinkMenu.tsx`: a copy of `SlashMenu.tsx` (listbox, `aria-activedescendant`, floating-ui), with the type icon, title and site per row and a "No matching cards" row.
- In `RichMarkdownEditor.tsx`, a second `Suggestion` with `char: "[["`, its own plugin key `teakCardLinks` and `allowSpaces: true`. Its items come from a new optional prop `searchCardLinks(query)`; when the prop is absent, the feature is off.
- Pill titles come from a new optional prop `resolveCardLinks(ids)` (one batched `getCardLinkTargets` subscription per editor). The `onOpenCard(id)` prop opens a card.
- Wiring: `TextPreview.tsx` and `AddCardForm.tsx` pass the props from `apps/web` (Convex hooks). The card modal opens the target by setting `?card=`.
- The read-only text rendering on grid tiles shows the stored titles.

## API / MCP / SDK / CLI

- No new endpoints in this phase. API, MCP and CLI content writes (`PATCH /v1/cards/:id`, `teak_v1_update_card`, `teak update`) already reach the content-edit handler, so they sync links.
- API `content` returns tokens verbatim. Document the token in `api.mdx`, so agents can write links.

## Docs

- `features.mdx`: a new "Link cards" subsection: type `[[`, how pills follow renames, and missing links.
- `(developers)/api.mdx` and `mcp.mdx`: the `[[Title|teak:<id>]]` token format.
- The ship month's changelog: "Link cards together with [[".

## UI states

- Empty: `[[` in an empty library shows "No cards yet".
- Loading: one skeleton row in the menu while the query is in flight; pills show the stored title until the live title loads.
- One item / many items: a single link, and a note with 500 pills, which must stay responsive with one batched query.
- Very long names: pill titles truncate at 40ch with a tooltip, and menu rows truncate.
- Error: on a failed query, the menu shows "Couldn't search cards"; the stored-title pill keeps working.
- Rate-limited: suggestion queries are debounced to 150 ms, and the save path is unchanged.

## Scenario seed packs

- `card-links`:
  - a note linking to itself
  - a note linking to a trashed card, to a hard-deleted ID and to a foreign user's ID
  - a note with 500 links and another with 501
  - a cycle A→B→C→A
  - a target renamed after linking
  - tokens inside code blocks, and malformed tokens (`[[x|teak:]]`, `[[x]]`)
  - RTL, CJK and emoji target titles, and a 300-character title

## Break-it checklist

- UI:
  - type `[[` then Esc, then type `[[` inside a code block (no menu)
  - type quickly and press Enter on a stale list
  - paste a raw token
  - undo and redo a pill insertion
  - two tabs editing the same note
  - rename the target in another tab (the pill updates live)
  - trash the target and restore it
  - check at 390px with keyboard only, in dark mode
- Backend:
  - another user's ID creates no row
  - 501 targets cap at 500
  - edits 20 times a minute converge
  - OCC through `occContention.test.ts`
  - hard delete removes both directions
  - account deletion leaves no rows
  - a non-text card never gets rows
- Editor corpus: a note that holds tokens opens without being rewritten (the README's preservation rule).

## Tests

- `packages/convex/cardLinks.test.ts` (convex-test): a token with a malformed or foreign-table ID syncs no row and renders as missing without failing the save; `searchCardLinkSuggestions` never returns a hidden card unless the query contains its revealing tag.

- `packages/convex/__tests__/shared/cardLinks.test.ts`: `formatCardLinkToken` with the 300-character and 512-character title fixtures, including titles that end in emoji and CJK, produces a token that `parseCardLinkIds` reads back with the same id, with a title of 200 characters or fewer.

- `packages/convex/__tests__/shared/cardLinks.test.ts`: the parse, format and replace table (code spans, malformed tokens, escaping, the 500 cap).
- `packages/convex/__tests__/card/displayTitle.test.ts`: the title rules move over unchanged.
- `packages/convex/cardLinks.test.ts` (convex-test, add to `vitest.config.ts`): sync diff, ownership, self-links, trashed target reported missing, hard-delete and account-deletion cascades, rebuild after an API content patch.
- `packages/convex/__tests__/card/mobileCardSummaries.test.ts`: `previewText` shows titles, not tokens.
- `packages/ui/src/components/text-editor/__tests__/markdownDocument.test.ts`: tokens keep a note rich and round-trip exactly.
- `packages/ui/src/components/text-editor/__tests__/CardLinkMenu.test.tsx`: rows, empty and error states (`renderToStaticMarkup`).
- `packages/tests/src/web/card-links.e2e.ts`: link two cards with `[[`, rename the target and see the pill update, click the pill and the target opens, trash the target and the pill shows "Missing card".

## Proof before the PR

- Video 1: type `[[`, pick a card, save, rename the target, see the pill update, then click it.
- Video 2: a note with 500 pills, trash one target (missing), restore it, and undo and redo.
- Screenshots: the menu (results, empty, error), pills (normal, missing, long title), in light and dark, at 390px and 1440px.
- A captured `PATCH /v1/cards/:id` with a token, and the resulting `cardLinks` rows from the dashboard.

## Release gate

1. Run the narrow tests above, then the repo checks, `markdown-editor.e2e.ts` and `card-links.e2e.ts`.
2. Seed `card-links`, run the break-it pass, and fix with regression tests.
3. Send the proof bundle.
4. Open the PR, get CI green, and merge. Deploy Convex (the new table and indexes), then web. No backfill.
5. Smoke-test production: link two test cards, rename one, and hard-delete one. Confirm the pills and rows.

## Risks And Open Questions

- The Tiptap Markdown extension is beta. A custom inline tokenizer must not break the semantic-equality corpus, so keep the whole compatibility corpus green.
- A Teak export re-imported (v1 phase 12) gets new card IDs, so the links point at missing cards. Rewriting tokens during a Teak-to-Teak import is a follow-up.
- The master plan says the table is "rebuilt whenever content is saved". It's rebuilt by a scheduled mutation right after the save, not inside it, to keep saves light and free of OCC conflicts. The rows lag by milliseconds.
