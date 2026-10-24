## Goal

Notes and search on iPhone, iPad, Mac and Android behave like the web:

- notes show tables and task checkboxes;
- ticking a checkbox saves it;
- writing `[[` links to another card through a picker;
- search understands `-`, uppercase `OR`, parentheses and `site:`, and suggests them.

Roadmap: [parity roadmap](./2026-10-24-parity-00-roadmap.md), phase 2. One PR. It comes after phase 1, so all new text goes into the catalogs.

## Success criteria

- A note with a GFM table shows a table on both apps; wide tables scroll sideways. It is never shown as raw `| a | b |` lines.
- A note with `- [ ]` items shows checkboxes.
  - Tapping one saves the note. The web shows the change live, and the other way round.
  - Checked items sort below unchecked ones, as on the web.
- In a note's edit field, typing `[[` opens a card search. Picking a card inserts `[[Title|teak:<id>]]`, and the note then shows a pill with the live title.
- In the search field:
  - `design -figma`, `tag:fonts OR tag:type`, `(site:github.com OR site:gitlab.com) -is:archived` and `site:github.com` return the same cards as the web for the same view.
  - On Android, a search that also contains a date word ("figma last week") keeps its text.
- Search suggestions offer "Exclude" and "Combine with OR", as the web does.
  - Apple: in its suggested tokens.
  - Android: a new suggestion list under the field.
- A plain note from either app saved as `"Simplicity is the ultimate sophistication." — Leonardo da Vinci` becomes a quote card, and one saved as `#264653 #2a9d8f #e9c46a` becomes a palette card, as on the web.

## Context and current facts

- **Search backend:**
  - `parseSearchQuery` (`packages/convex/shared/search/qualifiers.ts:806`) parses `-`, `OR` and parentheses into `ParsedSearchQuery.expression`, and `card/searchPlanner.ts` resolves it.
  - Both apps call `cards:searchMobileCardSummariesPaginated` (`card/mobileCardSummaries.ts:94`), which uses the web's validator and handler. **It already parses a raw `searchQuery` server-side. No backend change is needed.**
- **Apple search:**
  - `LibraryModel.commitText()` (`apps/apple/Teak/Features/Library/LibraryModel.swift:129`) turns typed text into tokens via `SearchTokens.parse` (`TeakKit/.../LibraryQuery.swift:207-256`). That strips parentheses, makes `OR` a keyword, drops duplicates, and moves `type:` and favorites into structured args. So `-`, `OR` and `( )` never reach the server.
  - `SearchQualifiers.swift:8-9` has no `site` key.
  - Suggestions come from `SearchTokens.suggestions` (`LibraryQuery.swift:258-272`).
- **Android search:**
  - `CardsRepository.page` sends the trimmed raw text as `searchQuery`, so operators already work.
  - `LibraryViewModel.kt:192-199` sends only `createdAtRange` and drops the text when `TimeSearch.parse` matches.
  - There are no typed suggestions, only `QualifierChips` (`core/model/.../SearchQuery.kt:400-435`).
- **Web suggestions:** `apps/web/src/components/search/searchSuggestions.ts`: `QUALIFIER_HINTS :86`, `EXCLUDE_HINTS :98`, the OR "Combine" hint `:106`, `IS_OPTIONS :117`. They aren't shared. Only `SEARCH_QUALIFIER_KEYS` is.
- **Notes storage:**
  - Tables are top-level GFM tables with one paragraph per cell. Task items are `- [ ]` / `- [x]`.
  - Card links are `[[Title|teak:<id>]]` (`packages/convex/shared/cardLinks.ts:1-11`).
  - The web saves edits with `cards:updateCardField({cardId, field: "content", value})` (`card/updateCard.ts:358`). `taskListSort.ts` reorders checked items.
- **Native renderers:**
  - Apple: `TeakKit/.../MarkdownBlocks.swift:3-10` and `Teak/Components/MarkdownView.swift`.
  - Android: `core/model/.../MarkdownBlocks.kt:3-12` and `feature/card/.../MarkdownText.kt`.
  - Both support heading, list, quote, code, rule and paragraph, and both already render card-link pills.
  - A task line shows as `• [ ] text`, and table rows fall through to a paragraph.
- **Edit screens:**
  - Apple `CardEditView.swift`: a plain multiline field for note and quote text.
  - Android `CardEditScreen.kt`: same.
- **Type detection:**
  - Native sends no `cardType` for non-link text (Apple `TextInput.swift:12-19`, Android `CardsRepository.kt:148-159`).
  - `createCard` detects quotes (`card/createCard.ts:178-191,262-271`), and the pipeline detects palettes (`workflows/steps/classificationMutations.ts:53-59`).

## Decisions

- **Search, Apple:**
  - Typed text is sent as written in `searchQuery`.
  - Tokens are made only from suggestions the person picks, and from whole-query qualifiers that have a structured arg today (type, favorites, archive, trash, color, style, date). These are lifted out only when the text has no `-`, `OR` or `(`.
  - Add `site` to `SearchQualifiers`.
  - Port the same rule to Android's `SearchQuery.kt` where it builds chips, since Apple's `AGENTS.md` asks for ports.
- **Search, Android:** when a date word matches, send both `createdAtRange` and the remaining text.
- **Suggestions:**
  - Move the web's hint lists (qualifier hints, exclude hints, the OR hint, `is:` options) into `packages/convex/shared/search/suggestionHints.ts` as data: ids, qualifier and i18n keys.
  - Generate them into both apps with the shared-constants scripts, and make the web import the same file.
  - Labels come from the catalogs (`search.*` keys already exist for the web).
- **Tables:**
  - Rendered read-only on both apps, with a header row and horizontal scroll.
  - Editing a table stays on the web. On native, the edit field shows the Markdown, as today.
  - Aligned, ragged or nested tables that the web keeps literal stay literal on native too, using the same rule.
- **Checkboxes:**
  - Tappable in the card view. A tap flips that one line in the stored Markdown and saves through `updateCardField` content, with an optimistic update. A failure rolls back with an error message.
  - Checked items move below unchecked ones within their list, using the web's sort rule ported from `taskListSort.ts`.
- **`[[` picker:**
  - Typing `[[` in the edit field opens a popover (Apple) or dropdown (Android). It searches cards with the same query the library uses, with Trash excluded.
  - Picking one inserts `[[Title|teak:<id>]]` and closes the popover. Escape or a non-match closes it.
  - Titles are truncated to the 200 characters `cardLinks.ts` allows.
- **Quote and palette:** no new UI. Prove server detection works from both apps. Fix only if the proof fails.

## Work

1. **Shared:** `suggestionHints.ts`, wired into the web's `searchSuggestions.ts` and generated into both apps.
2. **Apple:**
   - `LibraryQuery`/`LibraryModel` search changes and the `site` qualifier.
   - Suggested tokens for exclude and OR.
   - `MarkdownBlocks` gets `table` and `task` blocks; `MarkdownView` renders them.
   - A checkbox toggle in `CardDetailModel`.
   - The `[[` picker in `CardEditView`.
3. **Android:**
   - The date-word fix and a suggestion list in `LibraryChrome`.
   - Table and task blocks in `MarkdownBlocks.kt` and `MarkdownText.kt`, and the toggle in `CardDetailViewModel`.
   - The `[[` picker in `CardEditScreen`.
4. **Catalogs:** new native keys (picker empty state, toggle error, suggestion labels) in all 8.
5. **Docs:** `features.mdx` drops "the native apps show tables as text". Search syntax notes say the operators work on every app.
6. **Verify recipes:** `apple.md` and `android.md` gain `*-note-tables`, `*-tasks`, `*-card-link-picker` and `*-search-operators`. `search-operators.md` and `note-tables.md` list the native entry points.

## Tests

- **Parser and renderer:** TeakCoreTests and Android unit tests:
  - tables (plain, wide, ragged-stays-literal), task lines, mixed lists and card links inside cells;
  - a toggle flips exactly one line, including duplicates of the same text;
  - the sort order after a toggle;
  - search text kept verbatim with `-`, `OR` and `( )`.
- **Android:** a `LibraryViewModel` test for date word plus text.
- **Shared:** a test that the web suggestions and the generated native hints come from the same data.
- **E2E:** `packages/tests` is web-only. Native behavior is proved by driving the apps (below).

## Proof (private artifact page, linked under Proof)

- **Notes:**
  - Screenshots of the same seeded note (a table, a task list and a card link) on web, iPhone, iPad, Mac, Android phone and tablet, light and dark.
  - A video of ticking a checkbox on iPhone and seeing it ticked on the web live, then on Android.
  - A video of the `[[` picker on Mac and Android, ending on the new pill and on "Linked from" on the target card.
- **Search:**
  - Screenshots of the four example searches on web, Apple and Android, with matching result counts.
  - Android's "figma last week" before and after the fix.
  - The suggestions showing Exclude and OR on both apps.
- **Detection:** the quote and palette examples saved from iPhone and Android, shown as quote and palette cards.

## Release gate

1. Run `bun run check` and both local app builds.
2. Ship the web's shared-hint refactor and the apps in one lockstep release (no backend deploy is needed).
3. Production smoke test: tick a checkbox on each app, and run one `OR` search on each app.

## Risks and open questions

- **Concurrent edits:** two devices ticking different boxes at once. The toggle writes the whole content, so the later save wins. That is the same as the web today, and acceptable.
- **Open:** whether the native edit field should become a rich editor. Default: no. The plain field plus the picker is enough, and the web stays the full editor.
