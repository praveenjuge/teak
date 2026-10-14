## Goal

Give the unreleased Android app the same v2 follow-ups as the Apple app:
- hidden cards, with a hint
- a done toggle and `is:done` / `is:todo`
- Revisit
- More like this
- a "from site" footer
- read-only `[[` link pills
- OCR text and `text:`

The two apps then ship with the same features. Phase 31 of the [roadmap v2](2026-10-14-roadmap-v2-00-roadmap.md).

## Depends on

- [Phase 29](2026-10-14-roadmap-v2-29-apple.md) (the Apple behavior and pure-logic test tables this phase ports), plus its backend dependencies: phases 4, 5, 6, 10, 14, 15 and 26.

## Success Criteria

- Every item in phase 29's Success Criteria works on Android phones and tablets, with the same copy, behavior and test cases. Material 3 replaces the Apple-specific UI:
  - The Done toggle is an icon button in the detail top bar.
  - "More like this" and "Mark as done" sit in the detail overflow menu and in the long-press menu on tiles.
  - Revisit is a full-screen deck opened from the library top bar. Swipe left archives, with an Undo snackbar; swipe right keeps. A hardware keyboard's ←/→ works on tablets and ChromeOS.
  - Link pills are `AssistChip`s that open the target's detail, or show "Missing card".
  - Hidden-tag hint text appears in Edit, and a "Hidden cards" header in search.
  - OCR text appears in the detail's info section, and the "From site" row at the bottom.
- `./gradlew lint testDebugUnitTest :app:assembleRelease` passes. The Robolectric Compose tests cover each new screen state.
- The app stays unreleased. These features are in the first Play internal-testing build after this phase.

## Context And Current Facts

- **Modules.** The app follows Now in Android: `app`, `core:model`, `core:data`, `core:designsystem`, `core:testing` and `feature:{auth,library,card,capture,settings}`. Navigation 3 lives in `app/src/main/kotlin/com/praveenjuge/teak/ui/TeakNavigation.kt` (`apps/android/AGENTS.md`).
- **Convex access.** Calls go through `core/data/.../convex/ConvexApi.kt` by function name, with every number sent as a `Double`. The functions it uses are the same as the Apple app's: `cards:searchMobileCardSummariesPaginated`, `cards:getCard`, `cards:updateCardField`, `cards:createCard`, the upload pair and `cards:permanentDeleteCard`.
- **JSON.** Decoding uses `Json { ignoreUnknownKeys = true }` (`ConvexApi.kt:64`), so new backend fields don't break older builds.
- **Library state.**
  - `CardQuery { search, range, filters }` lives in `core/data/.../repository/CardsRepository.kt`.
  - `LibraryFilters` (`core/model/.../LibraryFilters.kt`) has only `favoritesOnly`, `trashOnly`, `types` and `hue`, with **no search-token model** like the Apple app's `SearchToken`. Typed qualifiers such as `like:` and `is:done` pass through `search` as text already.
  - There's no sort, no shuffle and no archive in `CardsRepository` (`setFavorite`, `moveToTrash`, `restore`, `deleteForever`, `apply(changes)`, `createFromText`).
- **Ported logic** lives in `core:model` with the same test cases as Apple: `CardSheet`, `CardGrid`, `LibraryFilters`, `TimeSearch`, `CardEdit`, `SaveLink`, `LinkDetection` and `MarkdownBlocks`. Markdown renders through `feature/card/.../MarkdownText.kt`, which uses `MarkdownBlocks.parse`.
- **Tests.**
  - Unit and Robolectric tests sit in each module's `src/test`. ViewModel tests use the fakes in `core:testing` and `core/data/src/test/.../Fakes.kt`.
  - Device tests are in `app/src/androidTest/.../LaunchSmokeTest.kt`.
- **Release.** `apps/android/release.md` is manual until Play production:
  - a signed AAB from `./gradlew clean lint testDebugUnitTest :app:bundleRelease`
  - Play internal testing, then closed testing (12 testers for 14 days), then production access
  - the version code is derived from the root `package.json`
- **Docs.** The docs site has no Android page; `(apps)/mobile.mdx` covers iOS only, while the pricing page lists Android.

## Constraints And Non-goals

- No backend changes. The same functions and qualifiers as phase 29.
- Port first, then build the UI. Pure logic goes into `core:model` with Apple's exact test tables:
  - `CardLinks.kt` (token parse and replace)
  - `HiddenTags.kt`
  - `SearchQualifiers.kt` (`is:done`, `is:todo`, `like:`, `text:` chips, plus `revisitArgs`)
- Revisit uses `sort: "shuffle"`, a random `shuffleSeed` (as a `Double`) and `numItems: 20.0`. It archives and unarchives through `cards:updateCardField`.
- Link pills are read-only. The edit screen keeps the Markdown source, and there's no `[[` menu.
- No new dependencies beyond the current version catalog.
- Material 3 components, dynamic color off (Teak theme), correct in light and dark, at phone and tablet widths.
- Don't add a docs page for Android until it's on Google Play. Note the features in this plan's PR body instead.

## Android

- `core/model`:
  - `CardLinks.kt`, `HiddenTags.kt`, `SearchQualifiers.kt`
  - `Card.kt` gains optional done, source URL and OCR text fields, named as in phases 15, 6 and 10
- `core/data`:
  - `CardsRepository` gains `setDone(id, done)`, `archive(id)`, `unarchive(id)`, `revisitDeck(query, seed)` and `linkTargets(ids)` (`cards:getCardLinkTargets`).
  - `CardQuery` gains `sort` and `shuffleSeed`, sent only for Revisit.
  - Fakes in `core/testing` and `Fakes.kt` are updated to match.
- `feature/card`:
  - `CardDetailScreen.kt` and `CardDetailViewModel.kt`: the done toggle (optimistic, with rollback), More like this (navigates to the library with `like:<id>`), the From site row, and the OCR text section.
  - `MarkdownText.kt`: pills built from `CardLinks.replaceCardLinkTokens` plus targets fetched once per screen.
  - `CardEditScreen.kt`: the hidden-tag hint.
- `feature/library`:
  - new `RevisitScreen.kt` and `RevisitViewModel.kt` (a swipe deck with `AnchoredDraggable`, an Undo snackbar, key handling, TalkBack custom actions "Archive" and "Keep")
  - `LibraryChrome.kt` gets a Revisit action and the qualifier chips
  - `CardTile.kt` gets long-press menu items
  - `LibraryScreen` gets the "Hidden cards" header
- `app/.../ui/TeakNavigation.kt`: a Revisit route, and a library route with an initial query.

## Docs

- No public docs page while Android is unreleased (see Constraints). The PR body lists the features for the future Play listing text in `apps/android/store/`.
- `apps/android/store/`: draft "What's new" text for the first production release.

## UI states

- Empty: "Nothing to revisit here.", "No hidden cards." and "Nothing similar yet." (the same copy as Apple).
- Loading: placeholder tiles in the library and the Revisit deck, and stored-title pills until the targets load.
- One item / many items: Revisit with 1, 19, 20 and 21 cards; 500 pills in one note, rendered lazily.
- Very long names: pills cut long titles in the middle; RTL and CJK lay out correctly; check the largest font scale.
- Error: a snackbar "Couldn't update this card." with rollback; a failed archive returns the card to the deck.
- Rate-limited: `RATE_LIMITED` shows "Too many changes. Try again in a moment.", and Revisit pauses input.

## Scenario seed packs

- The same packs as phase 29 (`apple-native` plus the v2 packs), run on a Pixel phone emulator, a tablet emulator (including a hardware keyboard) and the 16 KB-page emulator (`system-images;android-37.0;google_apis_playstore_ps16k;arm64-v8a`).

## Break-it checklist

- Revisit:
  - archive and Undo quickly
  - rotate mid-deck
  - process death, with "Don't keep activities" turned on
  - offline swipe
  - TalkBack only
  - a hardware keyboard holding →
- Done: rapid toggles, and two app instances in split screen.
- Pills: target trashed while open, a foreign ID, 500 pills while scrolling (no jank in the baseline profile).
- Qualifiers: `is:done is:todo` together, `like:` on a trashed card, `text:` with CJK.
- An older Android build installed against the new backend keeps working.

## Tests

- `core/model/src/test/.../CardLinksTest.kt`, `HiddenTagsTest.kt` and `SearchQualifiersTest.kt`: the same tables as Apple's `CardLinksTests.swift` and `LibraryTests.swift`.
- `core/data/src/test/.../repository/ConvexCardsRepositoryTest.kt`: `setDone`, `archive` and `revisitDeck` send the right function names and `Double` arguments.
- `feature/card/src/test/.../CardDetailViewModelTest.kt` and `CardDetailUiTest.kt`: the done toggle with rollback, pills (normal and missing), the From site row, OCR text.
- `feature/library/src/test/.../RevisitViewModelTest.kt` and `LibraryScreenTest.kt`: deck end, Undo, the hidden header (Robolectric Compose).
- `app/src/androidTest/.../LaunchSmokeTest.kt` (extend): open Revisit and archive one card on the emulator.

## Proof before the PR

- Emulator screen recordings: Revisit (archive, Undo, keep, end) on a phone; the done toggle, then `is:todo`, on a tablet; More like this and a link pill opening its target.
- Screenshots of every state above in light and dark, on a phone and a tablet.
- Output of `./gradlew lint testDebugUnitTest :app:assembleRelease`.

## Release gate

1. Run `./gradlew lint testDebugUnitTest :app:assembleRelease` and the `Unit Tests` workflow, then the device smoke test on the emulator.
2. Run the break-it pass on all three emulators, and fix with regression tests.
3. Send the proof bundle.
4. Open the PR, get CI green, and merge. No backend deploy.
5. Release by following `apps/android/release.md` exactly: the shared preparation in `.agents/releases.md`, the signed `bundleRelease`, `jarsigner -verify`, a real phone through Play internal testing, and the 16 KB-page emulator check. The build goes to internal or closed testing only, until Play grants production access.
6. Smoke-test on the internal-testing install against production: a done toggle, Revisit with Undo, a pill, and a hidden-tag search.

## Risks And Open Questions

- Android has no search-token model, so the chips for qualifiers are new UI there. Keep the scope to the four qualifiers in this phase, and don't port Apple's full `SearchToken` system.
- The field names from phases 6, 10 and 15 must match Apple's. Phases 29 and 31 should land in the same release cycle, so behavior never drifts.
- Play's 14-day closed-test clock means these features reach the public later than on Apple. That's expected, because Android is unreleased.
