## Goal

Teak works with the parts of iOS, iPadOS and macOS people reach without opening the app:

- Shortcuts and Siri can search Teak, open a card and add a card to a folder.
- Cards show up in Spotlight.
- Control Center and the iPhone Action button start a voice memo or a new note.
- The share extension can file what you saved into folders.

Roadmap: [parity roadmap](./2026-10-24-parity-00-roadmap.md), phase 4. One PR. It comes after phase 1, so all new text goes into the catalogs.

## Success criteria

- **App Intents.** The Shortcuts app lists these, each with an App Shortcut phrase:
  - **Save to Teak** (exists today).
  - **Search Teak**: a query in, cards out, using the same search syntax as the app.
  - **Open Card**: a card in, the app opens on it.
  - **Add to Folder**: cards and a folder in.
  - **New Note** and **Record Voice Memo**: open the app on the composer or the recorder.
- **Card and folder entities.** Shortcuts can pick a card or folder from a searchable list, and pass search results to other actions.
- **Spotlight:**
  - Searching a card's title in Spotlight on iPhone, iPad and Mac finds it, with its thumbnail. Tapping it opens the card in Teak.
  - Trashed, archived and hidden cards (`#secret`, `#hidden`) are never indexed.
  - Signing out removes everything Teak indexed.
- **Controls and Action button:**
  - A Control Center control for **New Note** and one for **Voice Memo** on iOS, plus the same on the Mac's Control Center or menu bar where macOS 26 supports controls.
  - Each opens the app on that screen.
  - Both can be assigned to the iPhone Action button.
- **Share extension:** after a single item is saved, a **Folders** row sits next to Tags and Note. Picking folders adds the card to them, and the sheet stays open while you choose. With several items saved, the folder choice applies to all of them.
- **Signed out:** every intent and control, used while signed out, says "Open Teak and sign in" (translated) and never crashes.

## Context and current facts

- **Project:** `apps/apple/project.yml` is the source.
  - Targets: Teak (iOS and macOS), ShareExtension, SafariExtension and TeakUITests. No WidgetKit target.
  - iOS and macOS 26, Xcode 27, Swift 6 strict concurrency.
  - After changing it, run `apps/apple/scripts/generate-project.sh` and commit `Teak.xcodeproj`; CI fails on drift.
- **Shared auth:**
  - All targets share the app group `group.com.praveenjuge.teak` and the keychain group.
  - `TeakServices.session()` and `TeakServices.http(session:)` (`TeakServices.swift:4-17`) give an extension a signed-in `ConvexHTTP` from the keychain. The credential lock lives in the app group.
  - `apps/apple/AGENTS.md:22-23`: hold the lock only inside `BackgroundActivity`, or iOS kills the process (0xdead10cc).
  - An extension needs the `TeakConvexURL`, `TeakAppGroup` and `TeakKeychainAccessGroup` Info.plist keys, or `TeakConfig` calls `fatalError` (`TeakConfig.swift:31-52`).
- **Existing intent:** `Teak/Intents/SaveToTeakIntent.swift` saves in-process with `ConvexFunctions.createCard`. `TeakShortcuts` (`:30-35`) is the `AppShortcutsProvider`, with one phrase.
- **Routing:**
  - `AppRouter.swift:62-72` handles `teak://save` and `teak://connect` only.
  - The router already has `compose(_:)`, `isRecording` and `open(CardRoute(id:summary:nil))` (`:39-52`).
  - `MainView` presents the composer and recorder sheets only while signed in (`RootView.swift:106-117`).
  - The router is the singleton `AppServices.shared.router`.
- **Data for entities and Spotlight:**
  - `CardSummary` (from `cards:searchMobileCardSummariesPaginated`) has `id`, `type`, `title`, `previewText`, `url`, `thumbnailUrl`, `isArchived`, and similar fields, but no tags or summary (`Models/Card.swift:39-58`).
  - The full `Card` (`getCard`) adds `content`, `notes`, `tags`, `aiTags` and `aiSummary`.
  - Nothing uses CoreSpotlight or `NSUserActivity` today.
- **Folders:** in TeakCore `ConvexFunctions`:
  - `listFolders` returns `[Folder]` with `id`, `name`, `color`, `kind` and `activeCardCount`.
  - `addCardsToFolder` and `setCardFolders`.
  - The app's `FolderPickerView` depends on `FoldersModel` and TeakSync, which is app-only, so the share extension can't reuse it as-is.
- **Share extension:** `ShareView.swift`. After one card is saved it shows Tags and Note (`:135-162`) and saves them with `updateCardField`. It auto-closes after 3 s unless the person starts typing (`:90-97`).
- **Release:**
  - `.github/workflows/apple-release.yml` hard-codes exactly two extensions: the bundle id env (`:47-48`), `ensure_profile` (`:406-408`), the export-options profiles (`:468-469`), the `-ne 2` count check (`:516`), the allowlist (`:579-581`), and the per-bundle `verify_bundle` checks (`:522-570`).
  - Every new bundle id must be registered by hand in the developer portal, with the App Group assigned (`apps/apple/release.md:68-75`). That step is the owner's.

## Decisions

- **Intents live in TeakCore-friendly code** in the app target (`Teak/Intents/`), run in-process where they can, and open the app only when they must (Open Card, New Note, Record Voice Memo).
- **`CardEntity`:**
  - `id`, `title` (falling back to the preview text), `type`, `url` and the thumbnail.
  - Its `EntityStringQuery` uses `searchMobileCardSummariesPaginated` with the typed text, first page only.
  - Its `suggestedEntities` returns the 20 newest cards.
- **`FolderEntity`:** manual folders only for Add to Folder, all folders for display.
- **Search Teak:**
  - Returns up to 20 `CardEntity` values for a query string, sent verbatim as `searchQuery` (phase 2 makes operators work).
  - An optional "include archived" parameter. Trash and hidden cards are never included.
- **Opening the app:**
  - A new `teak://card/<id>` route opens a card, and `teak://new-note` and `teak://voice-memo` open those screens.
  - Intents and controls use `OpenURLIntent` or `openAppWhenRun` with the router. If the person isn't signed in, the app shows the welcome screen and drops the request.
- **Spotlight:**
  - Index with `CSSearchableIndex` from the app only, as the library pages load, plus a background refresh of the newest 500 cards when the app becomes active.
  - Each card's `CSSearchableItem` carries title, preview text, URL host, type and thumbnail data.
  - Remove an item when the card is trashed, archived or hidden, as seen in the library's live updates.
  - Delete everything on sign-out and account deletion.
  - Don't index notes or full content, keeping the index small and private.
  - Make `CardEntity` an `IndexedEntity`, so Spotlight and Shortcuts share one identity.
- **Controls:**
  - A new WidgetKit extension target, `TeakWidgets` (bundle id `com.praveenjuge.teak.widgets`), with two `ControlWidgetButton`s that run the open-app intents.
  - It needs the shared app group and keychain Info.plist keys, but makes no network calls.
  - No home-screen widgets: the owner didn't choose them.
- **Action button:** comes from the same App Shortcuts (New Note, Record Voice Memo). No extra code beyond the shortcuts.
- **Share extension folders:**
  - A small extension-safe `FolderChecklist` view in TeakUI, fed by a one-shot `listFolders` query over `ConvexHTTP`. It shows manual folders, with search when there are more than 8.
  - It saves through `setCardFolders` for one card, and `addCardsToFolder` for several.
  - While the checklist is open, the auto-close timer pauses, as it does while typing.
  - Creating a folder from the extension is out of scope.
- **Release workflow:** update `apple-release.yml` from 2 to 3 extensions in every place listed above. `verify_bundle` checks the widget extension like the others.

## Work

1. **`project.yml`:**
   - The `TeakWidgets` target (iOS and macOS) with entitlements and the Info.plist keys.
   - Regenerate and commit `Teak.xcodeproj`.
2. **Intents:**
   - `CardEntity`, `FolderEntity`, `SearchTeakIntent`, `OpenCardIntent`, `AddToFolderIntent`, `NewNoteIntent` and `RecordVoiceMemoIntent`.
   - New phrases in `TeakShortcuts`.
3. **Router:** the three new `teak://` routes and their tests.
4. **Spotlight:** `SpotlightIndexer` in the app, hooked to library loads, card changes, sign-out and account deletion.
5. **Controls:** the `TeakWidgets` bundle with the two control buttons.
6. **Share extension:** `FolderChecklist` and the timer change.
7. **Release workflow:** the 3-extension changes. The `release.md` step names the new bundle id the owner registers.
8. **Catalogs:** intent titles, parameter names, phrases, control labels and the folder row, in all 8.
9. **Docs:**
   - `mobile.mdx` and `mac.mdx` describe the Shortcuts actions, Spotlight, controls and the Action button.
   - The App Store description (`store/store.config.json`) mentions Spotlight and the new Shortcuts.
10. **Verify recipes:** `apple.md` gains `apple-intents`, `apple-spotlight`, `apple-controls` and `apple-share-folders`.

## Tests

- **TeakCoreTests:**
  - `CardEntity` mapping (title fallback, a hidden card is excluded).
  - Spotlight item mapping and the exclusion rules.
  - Router parsing for `teak://card/<id>`, `teak://new-note` and `teak://voice-memo`, including bad ids.
- **TeakUITests:**
  - `teak://card/<id>` opens that card.
  - The share extension's folder row adds a card to a seeded folder.
- **Release workflow:** a dry run of the bundle checks on a local archive.

## Proof (private artifact page, linked under Proof)

- **Shortcuts:** a video building a shortcut with Search Teak → Add to Folder, running it, and the cards showing up in that folder on the web.
- **Siri:** Siri or Spotlight running "Search Teak" by its phrase on iPhone.
- **Spotlight:** screenshots on iPhone and Mac finding a seeded card by title, then tapping into Teak. A trashed card isn't found, and after sign-out nothing is found.
- **Controls:** a video of the Control Center controls and the Action button opening New Note and Voice Memo on an iPhone with an Action button (or the simulator's equivalent). Screenshots of the controls in light and dark.
- **Share extension:** a video sharing a link from Safari, picking two folders, and the card showing in both on the web.
- **Signed out:** each intent shows "Open Teak and sign in".
- **Release workflow:** the captured `verify_bundle` output listing three extensions.

## Release gate

1. The owner registers `com.praveenjuge.teak.widgets` in the developer portal with the App Group, before the release workflow runs.
2. Run `bun run check`, the local iPhone and Mac builds, and TeakCoreTests.
3. Release through `apps/apple/release.md` at the lockstep version: iOS first, the Mac after approval.
4. Production smoke test: Spotlight finds a new card, and the Action button opens New Note.

## Risks and open questions

- **App Review:** App Intents and Spotlight are routine, but the review notes should say what the controls open.
- **Index freshness:** Spotlight only learns about cards the app has seen. A card saved on the web shows in Spotlight after the app next becomes active. That's acceptable.
- **Open:** whether to index AI summaries for better Spotlight matches. Default: no, to keep the index small and private.
- **Open:** whether macOS 26 controls are worth the extra target there. Default: ship the same extension on both, if the Mac build allows it without extra entitlements.
