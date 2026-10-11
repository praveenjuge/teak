## Goal

Replace the Expo iPhone app (`apps/mobile`) and the native Mac app (`apps/mac`) with one native SwiftUI app in `apps/apple`. It runs on iPhone, iPad and Mac, ships under the existing App Store listing "Teak: Save Inspirations" (`com.praveenjuge.teak`), carries every feature of both apps to every platform where it fits, and looks like a polished, current Apple app.

## Success Criteria

- Every row in the parity checklist below works on each platform marked for it, verified in the real app on iPhone, iPad and Mac.
- iPhone and iPad ship first as an update to `com.praveenjuge.teak`, replacing the Expo build. Mac follows on the same listing as a universal purchase, and "Teak for Mac" is removed from sale on Mac launch day.
- One Xcode project, one multiplatform app target, one release workflow that uploads iOS and macOS builds to the same listing.
- Ported logic tests and XCUITest flows pass in CI. Sentry receives crashes from the app and its extensions on all three platforms.
- `apps/mobile`, `apps/mac`, their workflows and runbooks are deleted once the native app has been stable in production.

## Decisions (from the planning Q&A)

| Topic | Decision |
|---|---|
| Location | `apps/apple` |
| Minimum OS | iOS 26, iPadOS 26, macOS 26. Build with Xcode 27 and use iOS/macOS 27 APIs behind `#available` |
| Scope | Union of both apps' features, everywhere it fits. No new features beyond that |
| Rollout | iPhone + iPad first, Mac after, on the same listing |
| Old Mac listing | Remove "Teak for Mac" from sale as soon as Mac ships on the new listing. No goodbye update |
| Sign-in continuity | Users sign in again on every platform. No keychain migration |
| Backend | WorkOS AuthKit sign-in + Convex Swift client (same functions as iPhone and Android). No REST `/v1`, no OAuth "connected app" |
| Navigation | Adaptive `TabView`: tab bar on iPhone, sidebar on iPad and Mac |
| Card detail | Zoom transition into a detail page, with an inspector on wide windows |
| Note editing | Markdown source + rendered preview |
| Share sheet | The extension saves and uploads itself, without opening the app |
| Mac extras | Keep the menu bar item, the global Quick Capture hotkey, the Services menu and the Safari extension |
| Safari extension | One extension for iPhone, iPad and Mac |
| Mac UI | SwiftUI-first: `WindowGroup`, `Settings`, `MenuBarExtra`, `Commands`. AppKit only where SwiftUI has no API |
| Visual style | Native Apple look with Teak accents: system bars, sheets and Liquid Glass, Teak red tint, SF Rounded |
| Offline | Offline screen, as the iPhone app does today |
| Crash reporting | Sentry Cocoa SDK on all platforms, new project `teak-apple-prod` |
| Tests | Swift Testing for ported logic + XCUITest end-to-end flows |
| Releases | GitHub Actions + `asc`, one workflow for iOS and macOS |
| Store name | Keep "Teak: Save Inspirations" |
| Expo | Frozen now. No more `apps/mobile` releases |
| Old code | Delete `apps/mobile` and `apps/mac` after cutover is stable |

## Context And Current Facts

- **App Store Connect** (checked 2026-10-10):
  - "Teak: Save Inspirations", app ID `6756574989`, bundle `com.praveenjuge.teak`. iOS only. 1.0.82 is live and 1.0.85 is waiting for review. Latest build number 89.
  - "Teak for Mac", app ID `6770003409`, bundle `com.praveenjuge.teak-safari`. 1.0.72 is live and 1.0.85 is waiting for review. It also has an unused iOS platform slot with one expired build, so that slot can't be deleted. Never submit it.
  - "Teak (081ce8)", bundle `com.teak.app`. Empty and never submitted.
  - "iPhone and iPad Apps on Apple Silicon Macs" is now off for the iPhone listing. Vision Pro availability is on.
- **Usage, all time to Oct 8:**
  - iPhone: 88 first-time downloads, 190 update downloads, roughly 15 installed devices (an estimate).
  - Mac: 2 downloads.
  - Losing the Mac listing's users and ratings is negligible.
- **Apple rules:**
  - Two App Store records can't be merged. A Mac build on the iPhone listing must use bundle ID `com.praveenjuge.teak`.
  - Once two platforms are approved on one listing, they can't be separated.
  - Once iPad support ships, a later update can't drop it.
  - Sources: [Add platforms](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-platforms), [Universal purchase](https://developer.apple.com/support/universal-purchase/), [QA1623](https://developer.apple.com/library/archive/qa/qa1623/_index.html).
- **Project setup:** Apple's Xcode docs say one multiplatform target fits when every platform uses SwiftUI ([Configuring a multiplatform app](https://developer.apple.com/documentation/xcode/configuring-a-multiplatform-app-target)). App Store Connect help mentions uploading macOS builds "from a separate Xcode target". Phase 0 checks which one is true.
- **Platform releases:**
  - iOS 27, iPadOS 27 and macOS 27 shipped on 2026-09-14 with Xcode 27 (Swift 6.4).
  - Xcode 27 makes `@State` a macro and deprecates `PreviewProvider`.
- **iPhone app today** (`apps/mobile`):
  - Expo 57 and React Native 0.86, hosting SwiftUI through `@expo/ui`.
  - WorkOS AuthKit with PKCE. Redirect `teak://auth/callback`. The client ID comes from `api.auth.getAuthMode`.
  - Convex React client.
  - Share extension `com.praveenjuge.teak.share-extension` with app group `group.com.praveenjuge.teak`.
  - Siri intent "Save to Teak" opens `teak://save?text=`.
  - Sentry project `teak-mobile-prod`.
- **Mac app today** (`apps/mac`):
  - Bundle `com.praveenjuge.teak-safari`, plus Safari extension `com.praveenjuge.teak-safari.Extension`.
  - Signs in as an OAuth connected app: discovery, WorkOS `safari` client, redirect `teak-safari://oauth/callback`.
  - REST `/v1` API, keychain group and app group `group.com.praveenjuge.teak-safari`.
  - No Sentry.
  - Its core Swift files (`SafariOAuth`, `SafariCredentialStore`, `LibraryStore`, `LibrarySearchTokens`, `LibraryModels`) are Foundation-only and already tested by `scripts/test-mac-oauth.sh`.
- **Android** (`apps/android`) is the model to follow:
  - Native, with Convex calls by function name and WorkOS PKCE without `client_secret`.
  - Pure logic ported from iOS, with the same test cases.
  - Convex number arguments must be sent as doubles.
  - Convex functions it uses:
    - `auth:getAuthMode`, `auth:getCurrentUser`
    - `workosBootstrap:ensureUser`
    - `securitySessions:revokeAuthkitSession`
    - `accountDeletion:deleteMyAccount`
    - `cards:searchMobileCardSummariesPaginated`, `cards:getCard`, `cards:createCard`, `cards:updateCardField`, `cards:permanentDeleteCard`
    - `cards:uploadAndCreateCard`, `cards:finalizeUploadedCard`
- **Backend coverage:** `cards:searchMobileCardSummariesPaginated` already accepts `searchQuery`, `types`, `favoritesOnly`, `showTrashOnly`, `styleFilters`, `hueFilters`, `hexFilters` and `createdAtRange`. That covers every Mac search token except tags, which go through `searchQuery` as the iPhone app does today. `cards:findDuplicateCard` exists for the Safari extension. There's no bulk mutation, so bulk actions run one mutation per card, as the iPhone app does.
- **Swift packages:** [`convex-swift`](https://github.com/get-convex/convex-swift) 0.8.1 (ConvexMobile) is current. Android uses the Kotlin sibling, 0.8.0.

## Constraints And Non-goals

- **No new features.** That means no widgets, Control Center controls, Spotlight card entities, document scanner, on-device AI, offline library cache, title editing or image zoom. Each one can be a follow-up.
- **No backend changes.** No schema or function changes in `packages/convex`. If a parity gap turns out to need one, stop and ask (schema changes need explicit approval).
- **No keychain or session migration** from Expo or the old Mac app. Everyone signs in again.
- **External purchase links:** no upgrade link on iPhone or iPad (App Store rules, same as today). The Mac keeps its existing "Upgrade…/Manage…" link to web settings.
- **Old code stays put until cutover.** Don't touch `apps/mobile` or `apps/mac` before then, except to delete them in the cleanup phase.
- **Dependencies:** first-party frameworks first. Third-party Swift packages are limited to `convex-swift` and `sentry-cocoa`. WorkOS is plain HTTPS, as in the Expo app. Image caching is `URLCache` + ImageIO.
- **Hooks:** never bypass git hooks.

## Architecture

```
apps/apple/
  AGENTS.md                 workspace guide (build, run, rules, tests)
  release.md                release runbook
  Teak.xcodeproj
  Teak/                     multiplatform app target (iPhone, iPad, Mac)
    App/                    TeakApp, scenes, routing, deep links, commands
    Features/
      Auth/                 welcome, sign-in, loading, offline, error
      Library/              grid, search + tokens, filters, selection, context menus
      Card/                 detail, previews per type, inspector, edit, info
      Capture/              note/link, voice memo, photos, camera, files, paste, drop
      Settings/             appearance, account, delete account, about, Mac toggles
    Platform/macOS/         MenuBarExtra, Quick Capture panel, hotkey, Services, Safari status
    Platform/iOS/           camera, haptics glue
    Intents/                SaveToTeakIntent + AppShortcutsProvider
    Resources/              Teak.icon, assets, Info.plist, entitlements
  ShareExtension/           iOS + macOS share extension (saves directly)
  SafariExtension/          iOS + macOS Safari web extension (native handler + web resources)
  Packages/TeakKit/         Swift package
    Sources/TeakCore/       models, ported logic, Convex access, auth/session, uploads
    Sources/TeakUI/         SwiftUI pieces shared by the app and extensions
    Tests/TeakCoreTests/    Swift Testing
  TeakUITests/              XCUITest flows
  store/                    App Store metadata + screenshots (iPhone, iPad, Mac)
  scripts/                  metadata, screenshots, release helpers
```

**Identifiers**

| Thing | Value |
|---|---|
| App (iOS + macOS) | `com.praveenjuge.teak` |
| Share extension | `com.praveenjuge.teak.share-extension` (existing ID, reused) |
| Safari extension | `com.praveenjuge.teak.safari-extension` |
| App group | `group.com.praveenjuge.teak` (existing) |
| Keychain group | `$(AppIdentifierPrefix)com.praveenjuge.teak` (existing) |
| URL scheme | `teak://`: `auth/callback`, `save?text=`, `connect` (the Safari extension asks the app to sign in) |
| Team | `LW385M78LW` |
| Sentry | `teakvault/teak-apple-prod` |
| Version | Lockstep with root `package.json`. Build numbers continue above 89 for both platforms |

**TeakCore**

- **`TeakSession`.** The WorkOS PKCE sign-in, ported from `apps/mobile/lib/workos-native-auth.ts` and `workos-session.ts`:
  - provider buttons and `screen_hint`
  - the auth mode cached per Convex URL
  - JWT claim checks
  - refresh under 30 s, deduplicated
  - transport-failure backoff
  - generation counters for logout races
  - 10 s timeouts and a 64 KB response cap
  - Apple uses a non-ephemeral `ASWebAuthenticationSession`; every other provider is ephemeral.
- **Shared session storage.** The session lives in the shared keychain group so the extensions can use it. Refresh-token rotation is serialized across the app and extensions with a file lock in the app group container, ported from the Mac app's `flock` and epoch handling.
- **`ensureUser` bootstrap.** Retries on `profile_pending`, and maps `verify_email` and `frozen` to the existing messages.
- **`TeakBackend`.** Wraps ConvexMobile for live queries and mutations in the app. A small Convex HTTP caller (`/api/query`, `/api/mutation`, `/api/action` with a bearer) handles the bootstrap and the short-lived extensions. Every numeric argument is sent as a `Double`.
- **Ported pure logic, with the same test cases as the TypeScript and Mac Swift originals:**
  - library filters to query args
  - Mac search tokens (keyword, date phrases and ranges, type, tag, style, hue, hex, favorites, trash)
  - `parseTimeSearchQuery` parity
  - card-edit field diffs
  - Markdown blocks
  - `teak://save` raw parsing
  - text → link/note classification (`resolveTextCardInput`)
  - grid columns and tile ratios
  - waveform heights seeded by card ID
  - card-sheet share and copy rules
  - file-format inference and MIME lookup
  - the summary cache
- **Shared constants.** A script exports `@teak/convex/shared` constants to JSON:
  - limits, file formats, hue buckets, labels
  - error codes and messages
  - paused-signup and paused-account messages

  A Swift test fails if the ported constants drift from that JSON.
- **Uploads.** `uploadAndCreateCard`, then a signed PUT via `URLSession` upload from a file (ETag captured), retried on 408/429/5xx/network at 300 ms and 900 ms, then `finalizeUploadedCard`. Files are capped at 100 MB, and width, height and duration metadata are sent. The share extension uses the same pipeline.

## Native APIs And Polish

**Baseline (iOS/macOS 26), use freely**

- **Navigation and layout:**
  - `TabView` with `.tabViewStyle(.sidebarAdaptable)`, `tabBarMinimizeBehavior(.onScrollDown)`.
  - `NavigationStack` with `navigationTransition(.zoom)` + `matchedTransitionSource` from the tile.
  - `.inspector` for notes, tags, AI and info on wide windows.
- **Liquid Glass:**
  - System bars and sheets, with no custom backgrounds behind them.
  - `.buttonStyle(.glass/.glassProminent)` for primary actions.
  - `GlassEffectContainer` + `glassEffectID` for the floating selection bar and filter chips.
  - `ToolbarSpacer` groups, `scrollEdgeEffectStyle`, `backgroundExtensionEffect` behind the detail hero media.
  - Concentric shapes.
- **Search:** `.searchable(text:tokens:suggestedTokens:)` for the Mac token search on every platform, plus the filter menu.
- **Input and data transfer:**
  - `Transferable` drag and drop with `dragContainer`, `dropDestination`.
  - `PasteButton` and paste commands, `ShareLink`, `.fileImporter`/`.fileExporter`, `PhotosPicker`.
  - Camera via `UIImagePickerController` bridge (iOS only).
- **Media:** AVKit `VideoPlayer`, `AVAudioRecorder` with `AVAudioSession` (iOS) or `AVAudioApplication` permission, PDFKit `PDFView` wrapper.
- **Feedback and motion:** `sensoryFeedback` for every existing haptic, SF Symbols 7 effects on state changes (favorite, saved, recording).
- **Mac shell:** `MenuBarExtra`, `Settings` scene, `Commands` (also gives iPad its menu bar), `.onHover` video previews on Mac and iPad with a pointer.
- **Platform plumbing:** `@Observable` models, Swift 6 language mode with strict concurrency, `#Preview`, a layered app icon made in Icon Composer (light, dark, tinted, clear).

**iOS/macOS 27, behind `#available`**

- `Tab(role: .prominent)` for Add.
- `toolbarMinimizeBehavior`, toolbar `visibilityPriority` and `ToolbarOverflowMenu` for resizable iPad/Mac windows.
- `.swipeActions` on grid tiles (favorite, delete), using actions that already exist.
- `.confirmationDialog(item:)`/`.alert(item:)` for delete confirmations.
- `appearsActive`-aware styling for inactive iPad windows.
- Check layouts against resizable iPhone windows.

**Polish rules**

- **Platform conventions:**
  - Standard components over custom ones.
  - Tint only for meaning (Teak red `#dc2626`).
  - SF Rounded on all text.
  - Monochrome toolbar symbols, the same symbols on every platform.
  - The Teak wordmark only on welcome and empty states.
- **Layout:**
  - Layouts reflow at any window width.
  - The sidebar collapses into tabs on compact iPad.
  - Full keyboard support: menu commands, `⌘F`, arrow keys in the grid, Esc to leave selection.
- **Accessibility:**
  - VoiceOver labels everywhere the apps have them today, plus every icon-only button.
  - Dynamic Type through system text styles.
  - Respect Reduce Motion and Reduce Transparency.
- **Appearance:** light, dark and the user's Auto/Light/Dark override all reviewed on each platform before release.

## Feature Parity Checklist

Columns: iPhone (P), iPad (I), Mac (M). "Source" is where the behavior lives today. Every row needs a verified check on each marked platform.

### Sign-in, session, states

| Feature | P | I | M | Source |
|---|---|---|---|---|
| Welcome: "Save Anything. Anywhere.", wordmark | ✓ | ✓ | ✓ | both |
| Continue with Apple / Google, Register with Email (only when signups open), Login with Email | ✓ | ✓ | ✓ | mobile `welcome.tsx` |
| Per-button "Signing in…", buttons disabled while pending, silent cancel, failure alert | ✓ | ✓ | ✓ | mobile |
| Signups paused, verify-email and frozen messages | ✓ | ✓ | ✓ | mobile `workos-native-auth.ts` |
| `ensureUser` bootstrap with `profile_pending` retries | ✓ | ✓ | ✓ | mobile |
| Session refresh, race-safe logout, keychain retry on foreground | ✓ | ✓ | ✓ | mobile `workos-session.ts` |
| Log out with confirm, server revoke (`revokeAuthkitSession` with real `sid`), keep credentials if revoke fails | ✓ | ✓ | ✓ | mobile |
| Loading screen, "You're Offline" + Try Again, error screen with retry, 10 s connect timeout | ✓ | ✓ | ✓ | mobile |
| Safari extension "Sign in" opens the app's welcome (`teak://connect`) | ✓ | ✓ | ✓ | mac `teak-safari://connect` |

### Library

| Feature | P | I | M | Source |
|---|---|---|---|---|
| Masonry grid, shortest-column placement, skeleton loading grid | ✓ | ✓ | ✓ | both |
| Columns by width: 2 <700 pt, 3 ≥700, 4 ≥1000, 5 ≥1300; gap 12, edge 16, radius 16; ratio clamp 0.5–2.5 | ✓ | ✓ | ✓ | mobile `card-grid.ts` + mac widths |
| Pagination, auto-load near the end, pull-to-refresh, Refresh `⌘R` | ✓ | ✓ | ✓ | both |
| Tiles: note preview, link image + title + host, image with placeholder colour, video poster + play badge, hover video (pointer), audio waveform by card ID, document thumbnail/icon + name, palette (≤12 swatches), quote | ✓ | ✓ | ✓ | both |
| Tile badges: favorite heart, selection check, saving spinner, trashed dimming | ✓ | ✓ | ✓ | both |
| Title reflects view (Home, Trash, Favorites, a type, a colour, Filtered) | ✓ | ✓ | ✓ | mobile `library-filters.ts` |
| Search, debounced; time phrases ("last week", "march") | ✓ | ✓ | ✓ | mobile |
| Search tokens: date phrases and ranges, type, tag, style (13 + aliases), hue (11 + aliases), hex, favorites, trash; Enter commits, Backspace removes | ✓ | ✓ | ✓ | mac `LibrarySearchTokens.swift` |
| Filter menu: Favorites, Trash, types (multi), colour (single), Clear | ✓ | ✓ | ✓ | mobile |
| Tag/type/AI-tag chips in detail filter the library | ✓ | ✓ | ✓ | both |
| Empty states: first card (wordmark, "Let's add your first card!", Write a Note), no results, no matching cards, "Trash Is Empty" (30 days), Clear filters | ✓ | ✓ | ✓ | both |
| Context menu: Open Link, Copy Text/Link/Image/Quote/Palette, Share, Save to Files/Download, Add Tags, Favorite, Copy Link to Card, Open on Web, Select, Delete; in Trash Restore and Delete Forever | ✓ | ✓ | ✓ | both |
| Selection mode (Select, `⌘`-click, Select All, Esc), floating bulk bar: Favorite, Unfavorite, Delete, Restore, Delete Forever (confirm); partial-failure message | ✓ | ✓ | ✓ | both |
| Paste to save (`⌘V`, Paste as New Card): files, image, text | ✓ | ✓ | ✓ | mac (iPhone via `PasteButton`) |
| Drop files/images/text onto the library with "Drop files to upload" overlay | ✓ | ✓ | ✓ | mac |
| Optimistic favorite/delete/restore with rollback; new cards inserted when they match filters | ✓ | ✓ | ✓ | mac `LibraryStore.swift` |
| Status toast; Free-plan limit message (Mac adds "Upgrade…") | ✓ | ✓ | ✓ | both |
| Light haptic on tile tap; success/error haptics on actions | ✓ | ✓ | – | mobile `haptics.ts` |

### Card detail and editing

| Feature | P | I | M | Source |
|---|---|---|---|---|
| Zoom-in detail page, spinner while loading, "Card unavailable" | ✓ | ✓ | ✓ | both |
| Title: Note/Quote, else metadata title, file name, cached title | ✓ | ✓ | ✓ | mobile |
| Note: rendered Markdown, selectable; Preview/Edit with Markdown editor, double-click to edit, Save | ✓ | ✓ | ✓ | both |
| Quote: large quote, editable, empty quote rejected | ✓ | ✓ | ✓ | both |
| Link: preview image/screenshot, title, host, description, favicon, site/author/publisher, Details facts, Media (≤4) | ✓ | ✓ | ✓ | both |
| Image: fallback chain (detail, compact, thumbnail, file), HEIC/SVG thumbnails only, max height 440 | ✓ | ✓ | ✓ | mobile |
| Video: native player, autoplay on open, pause on close, poster, GIF as image, transcript | ✓ | ✓ | ✓ | both |
| Audio: play/pause, progress waveform, time label, silent-mode playback, transcript; webm/ogg/opus "can't play" message | ✓ | ✓ | ✓ | both |
| Document: thumbnail, facts ("PDF · 4.6 MB", slides, words, archive counts), PDF preview, inline text/code ≤512 KB, View/Open document | ✓ | ✓ | ✓ | both |
| Palette: swatches with hex labels, tap to copy + haptic | ✓ | ✓ | ✓ | both |
| Inspector/sections: Notes, AI Summary, AI tags, tags, colour dots, transcript | ✓ | ✓ | ✓ | both |
| Info: Type, Website, File, Format, Size, Dimensions, Duration, Created, Updated; copy URL and original content | ✓ | ✓ | ✓ | both |
| Actions: Share, Favorite, Edit, Copy, Open in Browser (sanitized), Download/Save to Files, Copy Link, Open on Web, Delete (to trash); in Trash Restore and Delete Forever | ✓ | ✓ | ✓ | both |
| Edit: content (note/quote), notes, tags (lowercased, deduped), remove AI tags ("Tags by Teak"); one `updateCardField` per changed field | ✓ | ✓ | ✓ | both |
| Unsaved-changes guard: block swipe-down, discard confirm | ✓ | ✓ | ✓ | both |

### Capture

| Feature | P | I | M | Source |
|---|---|---|---|---|
| Add tab: Write (Note or Link, Voice Memo), Upload (Photos & Videos, Camera, Files) | ✓ | ✓ | ✓ (no Camera) | mobile |
| New Note: autofocus, "Write a note or paste a link", URL → link card, raw Markdown kept, `⌘↩` saves, draft survives filtering, idempotency key | ✓ | ✓ | ✓ | both |
| Inline composer card in the grid | – | ✓ | ✓ | mac |
| Voice memo: timer, record/stop, permission, M4A AAC, 1 h max, upload as `audio/mp4` | ✓ | ✓ | ✓ | both |
| Photos & Videos picker (≤5, ordered), Camera photo/video | ✓ | ✓ | – | mobile |
| Files: picker, multiple, unsupported formats skipped with message, sequential queue with retry, 100 MB cap, "Saved N of M" | ✓ | ✓ | ✓ | both |
| `CARD_LIMIT_REACHED` handling | ✓ | ✓ | ✓ | both |

### System integrations

| Feature | P | I | M | Source |
|---|---|---|---|---|
| Share extension: text, URLs, images, movies, files (≤5 each), saves directly, "Saved"/partial/error states, signed-out → "Sign In Required" with Open Teak, de-dup | ✓ | ✓ | ✓ | mobile (Mac via union) |
| Safari extension: Save current page (Saved, Already saved via `findDuplicateCard`, Sign in, Cannot save this page, Error), Sign in, Sign out | ✓ | ✓ | ✓ | mac |
| Siri/Shortcuts "Save to Teak" (text or link), phrase "Save to Teak" | ✓ | ✓ | ✓ | mobile `save-to-teak-intent` |
| `teak://save?text=` parsed from the raw URL | ✓ | ✓ | ✓ | mobile `save-link.ts` |
| Menu bar item (opt-in): status line, Quick Capture, Paste as New Card, Open Library, Settings, Quit; drop onto icon | – | – | ✓ | mac `MenuBarController.swift` |
| Global Quick Capture `⌃⌥⌘T` (toggle in Settings), floating panel with Choose Files | – | – | ✓ | mac `QuickCapture.swift` |
| Services menu "Save to Teak" (text, URL, file, image) | – | – | ✓ | mac `NSServices` |
| Capture HUD with VoiceOver announcement | – | – | ✓ | mac `CaptureHUD` |
| Menus and shortcuts: New Note `⌘N`, Upload `⇧⌘U`, Quick Capture, Find `⌘F`, Refresh `⌘R`, Select All, standard Edit/Window menus, dimmed (never hidden) when unavailable | – | ✓ | ✓ | mac `LibraryCommands.swift` |

### Settings and account

| Feature | P | I | M | Source |
|---|---|---|---|---|
| Appearance Auto/Light/Dark, persisted | ✓ | ✓ | ✓ | both |
| Email, usage ("N of 200 Cards" / "N Cards"), plan Free/Pro | ✓ | ✓ | ✓ | both |
| Upgrade…/Manage… opens web settings | – | – | ✓ | mac |
| Delete Account: confirm, type "delete account", `deleteMyAccount`, local clear; disabled with paused message | ✓ | ✓ | ✓ | mobile |
| Log Out | ✓ | ✓ | ✓ | both |
| Quick Capture shortcut toggle, Menu bar toggle | – | – | ✓ | mac |
| Safari extension status + Open Safari Settings (Mac); enable instructions (iOS) | ✓ | ✓ | ✓ | mac |
| About: by @praveenjuge, thanks line, feedback (x.com/praveenjuge, email), delete-account web link, version (build) | ✓ | ✓ | ✓ | both |

### Deliberately not carried over

- **Mac OAuth connected-app code:**
  - discovery
  - the `safari` client
  - the `teak-safari://` scheme
  - REST `/v1` calls
  - `/api/safari/account-summary`
  - the legacy WKWebView companion page (`Main.html`, `Script.js`, `Style.css`) and `companion.test.ts`
- **Expo-only plumbing:**
  - `expo-sharing` handoff via app group UserDefaults
  - `+native-intent.ts`
  - Expo Router routes
  - the `save-to-teak-intent` config plugin (the intent itself carries over)

## Testing

- Follow `.agents/testing.md`.
- **Swift Testing in `TeakKitTests`:**
  - Port every pure-logic case from `apps/mobile/__tests__/lib/*` and the Mac Swift tests:
    - search tokens and date math
    - PKCE and callback validation
    - session refresh races and identity-change rejection
    - upload sequencing and retries
    - optimistic rollback, pagination
    - Markdown, save-link parsing
    - grid, waveform, card edits, file formats
  - Plus the constants drift test.
- **XCUITest flows** against the local stack with the WorkOS emulator (`packages/tests/README.md`):
  - sign in, create note and link, upload file
  - favorite, edit notes/tags, delete/restore/delete forever
  - search with tokens, sign out
  - Run on iPhone and Mac. iPad runs a layout smoke test.
- **Extension tests:**
  - the Safari popup JS test, ported from `apps/mac/tests/safari-popup.test.ts`
  - share-extension normalization tests in TeakCore
- **CI:** `xcodebuild test` for TeakKit and the UI tests, added to `unit-tests.yml` and `e2e.yml`.

## Release And CI

- **`.github/workflows/apple-release.yml`:**
  - Triggered by the lockstep version tag, like today.
  - On a macOS runner with Xcode 27: archive iOS and macOS from the one project, sign via `asc`, verify bundle IDs, entitlements and versions, upload dSYMs to Sentry.
  - Upload both builds to app `6756574989`, apply metadata and screenshots, submit, write the proof manifest.
  - Phase 1 ships iOS only. Phase 2 adds macOS.
- **`apps/apple/store/`:**
  - One metadata set under "Teak: Save Inspirations".
  - Screenshots for iPhone 6.9", iPad 13" and Mac.
  - Fix description claims the code doesn't back: "Work offline with local caching" and "scan documents" (iPhone), "edit card titles" (Mac).
- **Lockstep version files:** add `apps/apple` to `.agents/releases.md`. Retire `mobile-release.yml` and `mac-release.yml` in cleanup.
- **Pointers:** root `AGENTS.md` release pointers become "Apple: `apps/apple/release.md`". Write `apps/apple/AGENTS.md` and `release.md`.
- **Docs:** update the iPhone and Mac pages and the changelog per `apps/docs/AGENTS.md`.

## Phases

0. **Foundation spike**
   - Create `apps/apple` with the multiplatform target, TeakKit, signing, Sentry and ConvexMobile.
   - Get sign-in working on iPhone, iPad and Mac against the shared dev deployment.
   - Upload one TestFlight build for iOS and one for macOS under `com.praveenjuge.teak`. This proves whether one target works for both upload paths. If App Store Connect rejects it, split into an iOS target and a macOS target that share all sources.
1. **TeakCore:** models, ported logic + tests, session store with cross-process lock, backend wrapper, upload pipeline, constants export + drift test.
2. **Library and detail:** grid, tiles, search tokens, filters, pagination, selection, context menus, detail per type, inspector, info.
3. **Capture, edit, settings:** note/link, voice memo, photos, camera, files, paste, drop; edit sheet; settings, delete account, about.
4. **Integrations:** share extension, Safari extension (all platforms), Save to Teak intent, `teak://` routes, Mac menu bar, hotkey, Services, Quick Capture, HUD, commands.
5. **Polish pass:**
   - Liquid Glass review, transitions, keyboard and pointer, accessibility audit, iOS/macOS 27 additions.
   - App icon; light/dark per platform.
   - Walk the parity checklist on real devices.
6. **Tests and release:** XCUITest suite in CI, `apple-release.yml` (iOS), store metadata and screenshots, TestFlight on iPhone and iPad.
7. **iPhone + iPad launch:**
   - Submit as the next lockstep version on `com.praveenjuge.teak` with iPad support (permanent).
   - Watch Sentry and reviews for a release or two.
8. **Mac launch:**
   - Add the macOS platform to app `6756574989`, ship the Mac build via the same workflow.
   - On approval, remove "Teak for Mac" (`6770003409`) from sale.
9. **Cleanup** (after stable):
   - Delete `apps/mobile`, `apps/mac`, `mobile-release.yml`, `mac-release.yml`, `mac-oauth-runtime.yml`, the old runbooks and doc pages.
   - Separately decide on backend leftovers: the WorkOS `safari` client, the `teak-safari://` redirect, `/api/safari/account-summary`.

## Risks

- **One target vs two for uploads.** Apple's docs disagree. Phase 0 settles it before feature work.
- **Share-extension memory and time limits** while uploading up to 5 files of up to 100 MB. Upload from file URLs, stream, never load whole files into memory. Test the largest case on a real device.
- **Refresh-token rotation** between the app and two extensions. The cross-process lock is required. Test sign-out during an in-flight extension save.
- **macOS App Group and keychain sharing** with the `group.` prefix in a sandboxed Mac App Store app needs a correct provisioning profile. Verify in Phase 0.
- **WorkOS emulator support** for native PKCE redirects to `teak://auth/callback` in XCUITest is unverified. If it can't, the UI tests inject a test session through a debug-only launch argument.
- **Mac "Upgrade…" link** has passed review on the old listing, but reviewers may treat it differently on a universal listing. If it gets rejected, drop the link on Mac too.
- **Expo freeze.** Any urgent iPhone bug before launch has to wait for the native app or needs an explicit exception.
- **iPad support is permanent** after the first approved build, and so is the universal purchase after Mac approval.

## Open Questions

- **App icon.** Praveen will provide the `Teak.icon` file when it's needed. Ask for it when the icon step comes up, and don't make one.
- **Grid breakpoints.** The iPhone (2/3/4 columns) and Mac (1/2/3/5) rules are merged into one: 2/3/4/5 at 0/700/1000/1300 pt. Confirm during the polish pass.
