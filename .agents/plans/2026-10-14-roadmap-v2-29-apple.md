## Goal

Bring the v2 card and search features to the native Apple app on iPhone, iPad and Mac:
- hidden cards, with a hint in the UI
- a done toggle and `is:done` / `is:todo`
- Revisit
- More like this
- a "from site" footer on saved text
- read-only `[[` link pills
- OCR text and the `text:` qualifier

> **Owner decision (2026-10-17, phase 10):** the text Teak reads from images (`aiOcrText`) is for search only. No UI shows it, and the API, MCP, SDK and CLI never return it; plain search and the `text:` qualifier use it. Skip every step below that displays, copies or decodes OCR text, and keep only the `text:` chip.

Phase 29 of the [roadmap v2](2026-10-14-roadmap-v2-00-roadmap.md).

## Depends on

- Phase 4 (hidden tags), phase 5 (Revisit), phase 6 (source for Save Text), phase 10 (OCR), phase 14 (`like:`), phase 15 (done states) and [phase 26](2026-10-14-roadmap-v2-26-card-links.md) (`cards:getCardLinkTargets`).

## Success Criteria

- **Hidden cards.** They disappear from the library and search on every platform with no client change. The backend does it through `cards:searchMobileCardSummariesPaginated`. Two hints:
  - Adding the tag `private`, `nsfw` or `hidden` in Edit shows: "This card will be hidden. Search #private to find it." The tag in that line matches the one added.
  - Searching one of those tags shows a "Hidden cards" header above the results.
- **Done.** Card detail has a Done toggle (toolbar on Mac and iPad, More menu on iPhone), with haptics and an optimistic state. Search tokens `is:done` and `is:todo` appear as chips and in suggestions.
- **Revisit.** The library's toolbar has a Revisit entry. It shows up to 20 random cards from the current view, one at a time:
  - Swipe left or ← archives the card, with Undo.
  - Swipe right or → keeps it.
  - The deck ends with "All caught up".
- **More like this.** Card detail's More menu (and the context menu on tiles) has "More like this". It opens the library with a `like:<id>` chip.
- **"From site" footer.** A text card with a source URL shows "From example.com" at the bottom of its detail. Tapping it opens the page in the browser, checked with the existing unsafe-URL rule.
- **Link pills.** `[[Title|teak:<id>]]` tokens render as tappable pills that show the target's current title and open that card, or "Missing card" when the target is gone. The Markdown edit sheet keeps the raw token. Tiles show the title.
- **OCR text.** Card detail shows the OCR text under Info ("Text in image", collapsible, copyable). A `text:` qualifier typed into search becomes a "Text" chip.
- Each of these works the same on iPhone, iPad and Mac, and an older build keeps working against the new backend.

## Context And Current Facts

- **How the app talks to Convex.** It calls functions by name through `ConvexArgs`, with every number sent as a `Double` (`apps/apple/AGENTS.md`). The functions in use:
  - `cards:searchMobileCardSummariesPaginated`, `cards:getCard`, `cards:updateCardField`, `cards:createCard`
  - `cards:permanentDeleteCard`, `cards:uploadAndCreateCard`, `cards:finalizeUploadedCard`
  - plus auth and account functions
- **Library search.**
  - `searchCardsPaginatedArgsValidator` (`card/getCards.ts:314`) already accepts `sort: "newest" | "oldest" | "shuffle"` and `shuffleSeed`, but the app sends neither.
  - The app has no sort menu, no Archive view and no archive action. `Card` (`Models/Card.swift`) has no `isArchived` field.
  - `updateCardField` already accepts `"archive"` and `"unarchive"` (`card/updateCard.ts:36`).
- **Search tokens.** `SearchToken.Kind` (`Logic/LibraryQuery.swift:40`) is `keyword, date, type, tag, style, hue, hex, favorites, trash`. Unknown text such as `like:abc` or `is:done` becomes a `.keyword` token. Keyword words are joined into `searchQuery`, so qualifiers already reach `parseSearchQuery` on the server. Only the chips and suggestions are missing.
- **Markdown.** `Logic/MarkdownBlocks.swift` parses headings, lists, quotes, code, rules and paragraphs. `Components/MarkdownView.swift` renders paragraphs with `AttributedString(markdown:)`. Tiles use `MarkdownBlocks.plainText(previewText)`; phase 26 already swaps tokens for titles in `previewText` on the server.
- **Decoding.** `CardSummary` and `Card` are `Decodable` structs, so new JSON keys are ignored. That's why older builds keep working.
- **Card detail.** `Features/Card/CardDetailView.swift` has a toolbar (Favorite, Edit, More menu, Info inspector) and `moreMenu` with Copy, Open in Browser, Download, Copy Link to Card, Open on Web and Delete.
- **Tests.**
  - Swift Testing: `Packages/TeakKit/Tests/TeakCoreTests/{CardTests,LibraryTests,SessionTests,UploadTests}.swift`
  - XCUITest: `TeakUITests/{LibraryFlowTests,SignInTests}.swift`, run against the local E2E stack with `scripts/ui-tests.sh ios|ipad|mac`
  - CI runs the iPhone and iPad UI tests only.
- **Rules.**
  - Port any logic change to Android (`apps/android/AGENTS.md`); phase 31 does that.
  - Shared constants come from `SharedConstants.json`, regenerated by `scripts/shared-constants.ts`.
- **Release.** `apps/apple/release.md`: iOS first, then the Mac once iOS is approved; `store/store.config.json` carries What's New.

## Constraints And Non-goals

- No backend changes. Every needed function and qualifier ships in phases 4–26. If a gap appears, stop and add it in a backend PR first.
- Reserved hidden tags come from `SharedConstants.json`, regenerated after phase 4 adds them to `shared/constants`. They're not hard-coded in Swift.
- Revisit:
  - It uses `sort: "shuffle"` with a fresh `shuffleSeed` and the current filters, taking `numItems: 20`. It archives through `updateCardField "archive"` and undoes through `"unarchive"`.
  - Archived cards are found with `is:archived`. A full Archive view is out of scope.
- Link pills are read-only. The edit sheet edits Markdown source, so tokens stay intact.
- There's no `[[` suggestion menu on native. Backlinks are a follow-up.
- No new third-party packages. SF Rounded, system components first, Teak red only for meaning.
- Keyboard shortcuts (Mac and iPad) must not collide with system ones:
  - ⌘D Done
  - ⌘⇧L More like this
  - ⌘R Revisit
  - ←/→ inside Revisit

## Apple

- `TeakCore/Logic/LibraryQuery.swift`:
  - `SearchToken.Kind` gains `done`, `todo`, `like` and `text`.
  - `classify` recognizes `is:done`, `is:todo`, `like:<id>` and `text:"…"`.
  - `searchArgs` writes them back into `searchQuery` as typed.
  - `suggestions` offers Done and To do.
  - `LibraryQuery` gains `revisitArgs(seed:)`.
- `TeakCore/Logic/CardLinks.swift`: a port of `shared/cardLinks.ts` (`parseCardLinkIds`, `replaceCardLinkTokens`), using the same pattern string and test table.
- `TeakCore/Logic/HiddenTags.swift`: `isHiddenTag(_:)` and `hiddenTagHint(for:)`, using `tagKey` rules (case and spaces).
- `TeakCore/Models/Card.swift`: optional fields for the done state and the source URL, named as in phases 15 and 6, plus `aiOcrText`. That is the field name phase 10 actually exposes, so the synthesized `Decodable` picks it up. The Swift property is named `aiOcrText` too, with no `CodingKeys` remapping, which keeps the decoder test honest.
- `Components/MarkdownView.swift`: inline pills for link tokens. Tokens are resolved with one `cards:getCardLinkTargets` call per detail view and shown through `Button` with `.buttonStyle(.bordered)` and a type symbol.
- `Features/Card/CardDetailView.swift`:
  - the Done toggle, with the toolbar on regular width and `moreMenu` on compact
  - "More like this" in `moreMenu`, which opens the library through `TeakRouter` with a `like` token
  - the "From site" footer
  - "Text in image" in the inspector and Info
- `Features/Card/CardDetailModel.swift`: `toggleDone()`, optimistic with rollback.
- `Features/Card/CardEditView.swift`: the hidden-tag hint under the tags field.
- New `Features/Library/RevisitView.swift`:
  - a card stack with `DragGesture`
  - `.onKeyPress(.leftArrow/.rightArrow)` on Mac and iPad
  - Undo through a bottom toast, haptics on iPhone
  - VoiceOver actions "Archive" and "Keep"
  - opened from a toolbar button in `LibraryView.swift`, as a sheet on iPhone and a window-sized cover on iPad and Mac
- `Features/Library/CardContextMenu.swift`: "More like this" and "Mark as done".
- **Semantic results on native.** Writing `like:<id>` (or free text) into the query only subscribes to the cached ranking. It never runs Vectorize. So the library view model calls phase 13's `search.semanticActions.requestSemanticResults` action (with the same args the query uses) whenever the query has free words, a `like:` token or a `mood:` token, and in parallel with subscribing to `searchMobileCardSummariesPaginated`. The reactive query then picks up the cache row on its own. An action failure or rate limit falls back to keyword results silently. The action is debounced like the web search (300 ms) and skipped for empty queries.
- `Features/Library/LibraryView.swift`: the "Hidden cards" header when the query has a hidden tag token.
- `App/` commands: menu items with the shortcuts above.

## Docs

- `content/docs/(apps)/mobile.mdx` (iPhone and iPad) and `mac.mdx`: Done, Revisit, More like this, link pills, OCR text, hidden cards and the new search chips.
- `apps/apple/store/store.config.json` `version.whatsNew`: one short line per feature.
- The ship month's changelog: a "Teak for iPhone, iPad and Mac" item covering these.

## UI states

- Empty:
  - Revisit with 0 cards: "Nothing to revisit here."
  - "Hidden cards" with no results: "No hidden cards."
  - More like this with no results: "Nothing similar yet."
- Loading: redacted placeholder cards in Revisit and the library, and pills show the stored title until targets load.
- One item / many items: Revisit with 1, 19, 20 and 21 cards (it caps at 20); a note with 500 pills.
- Very long names: pills truncate in the middle, and a 300-character title wraps in Revisit. Check RTL and CJK.
- Error: failed toggles roll back with "Couldn't update this card." A failed archive in Revisit puts the card back.
- Rate-limited: `RATE_LIMITED` from `updateCardField` shows "Too many changes. Try again in a moment.", and Revisit pauses.

## Scenario seed packs

- Reuse the v2 packs on an iPhone 17 simulator, an iPad Pro 13" simulator and a Mac: `hidden-cards`, `revisit`, `done-states`, `similar-and-mood`, `ocr-images`, `card-links` and `backlinks`.
- Add `apple-native`: one account with every card type in done and todo states, hidden-tag variants (`Private`, `NSFW` with a trailing space, and `hidden` with a leading space), text cards with and without a source URL, and images with long OCR text.

## Break-it checklist

- Revisit:
  - archive then Undo quickly
  - swipe while the network is offline
  - rotate the iPad mid-deck
  - hold → on Mac
  - background and relaunch mid-deck
  - VoiceOver only
- Done: toggle 10 times quickly, and in two windows on Mac and iPad.
- Pills: a target trashed while the detail is open, a foreign ID, 500 pills (scroll performance), and Dynamic Type at the largest size.
- Search chips: `is:done is:todo` together, `like:` on a trashed card, `text:` with quotes and CJK.
- Hidden: add `Private` and see the hint, then remove it.
- Old build: install the current App Store build, run it against the new backend, and confirm nothing breaks.

## Tests

- `Packages/TeakKit/Tests/TeakCoreTests/LibraryTests.swift`: classify and `searchArgs` tables for `is:done`, `is:todo`, `like:`, `text:` and `revisitArgs`. A view-model test asserts that `requestSemanticResults` is called for `like:<id>` and free-text queries, and not for qualifier-only queries. A decoding test asserts that a card JSON with `aiOcrText` populates the property.
- `Packages/TeakKit/Tests/TeakCoreTests/CardLinksTests.swift`: the same table as `packages/convex/__tests__/shared/cardLinks.test.ts`.
- `Packages/TeakKit/Tests/TeakCoreTests/CardTests.swift`: decoding with and without the new fields, and the hidden-tag hint.
- `TeakUITests/RevisitFlowTests.swift`: open Revisit, archive one card, Undo, keep one card, end of deck.
- `TeakUITests/LibraryFlowTests.swift` (extend): mark done, then search `is:done`; open More like this from detail.
- `apps/apple/tests/shared-constants.test.ts`: still green after regenerating with the hidden tags.

## Proof before the PR

- Videos, from simulator and device captures, sent with SendUserFile:
  1. iPhone: Revisit (archive, Undo, keep, end).
  2. iPad: done toggle, then an `is:todo` search.
  3. Mac: More like this from the context menu, a link pill opening the target, and the keyboard shortcuts.
- Screenshots of every state on iPhone, iPad and Mac, in light and dark: hidden hint, Revisit empty and full, pills and missing pill, "From site" footer, OCR text.
- `swift test` output, and `scripts/ui-tests.sh ios` and `ipad` output.

## Release gate

1. Run `swift test --package-path apps/apple/Packages/TeakKit`, `bun --no-env-file test apps/apple/tests/`, and `scripts/ui-tests.sh ios|ipad|mac` against the local E2E stack. Build locally for iPhone and Mac (CI doesn't build the app).
2. Run the break-it pass on all three platforms, and fix with regression tests.
3. Send the proof bundle.
4. Open the PR, get CI green, and merge.
5. Release by following `apps/apple/release.md` exactly:
   1. `bun run release:prepare <next patch>` (`.agents/releases.md`), merged to `main`.
   2. `Version Tag` dispatches `apple-release.yml` with `platforms=ios`.
   3. Wait for App Review approval.
   4. `gh workflow run apple-release.yml -f version=<v> -f platforms=macos -f dry_run=false`.

   Update `store.config.json` What's New first, and screenshots per `scripts/store-assets/README.md` if the library chrome changed. No backend deploy: the backend shipped in phases 4–26.
6. Smoke-test production after release: on a real iPhone and Mac, a done toggle, Revisit archive with Undo, a pill opening its target, and a hidden-tag search.

## Risks And Open Questions

- Field names for the done state, the text source URL and OCR text are set by phases 15, 6 and 10, which haven't been written yet. Use their final names, and keep every new Swift field optional.
- Revisit archives cards, but the app has no Archive view to find them again except by `is:archived`. Add an Archive filter chip if the owner wants it.
- Android (phase 31) must port `LibraryQuery`, `CardLinks` and `HiddenTags` with the same test tables in the same cycle, so the two apps ship together.
