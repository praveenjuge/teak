## Goal

The iPhone, iPad, Mac and Android apps speak the same 8 languages as the web and the extension: English, Spanish, Portuguese (Brazil), German, French, Japanese, Korean and Simplified Chinese. The language follows the account, as it does on the web. People can change it in the app's Settings → Language, and in the system's per-app language list (iOS, macOS, Android 13+). In the same PR, every client uses one word for each action.

Roadmap: [parity roadmap](./2026-10-24-parity-00-roadmap.md), phase 1. One PR.

## Success criteria

- Every user-visible string in the Apple app (main app, share extension, Safari extension popup, App Intent, Info.plist permission text) and in the Android app (all modules, share sheet, shortcuts, upload notification) comes from a catalog generated from `packages/i18n`.
- Switching the account to German on the web turns the native apps German on their next launch or foreground, and switching in the native app turns the web German.
- Choosing a language in iOS Settings → Teak → Language, macOS System Settings → Language & Region → Applications, or Android 13+ Settings → Apps → Teak → Language changes the app and writes the account's language.
- Dates, numbers and plurals follow the language ("1 card" / "2 cards", 「3 枚のカード」 and so on).
- The labels in the wording table below match on web, Apple, Android, Raycast and the Safari popup.
- `bun run check` passes, including the catalog test, and a deliberately removed native key fails it.

## Context and current facts

- **Catalogs:** `packages/i18n/messages/{en,es,pt-BR,de,fr,ja,ko,zh-Hans}.json` are nested ICU catalogs: 1,204 English leaf keys in 26 namespaces, about 55 plurals and 16 selects.
  - `scripts/i18n-catalog.test.ts` checks that each catalog has the same keys and placeholders as English, and that translations aren't copied English.
  - `packages/i18n/src/locales.ts` holds `SUPPORTED_LOCALES`, `LOCALE_NAMES`, `resolveUiLocale` and `extensionLocaleDir` (pt-BR → `pt_BR`, zh-Hans → `zh_CN`).
  - The rules and glossary are in `apps/docs/content/docs/(open-source)/translating.mdx`. Line 7 says the native apps are English only.
- **Account language:**
  - `userPreferences {userId, locale, updatedAt}` (`packages/convex/schema.ts:580-584`).
  - Public `settings/preferences:getPreferences` returns `{locale}` or `null`; public `settings/preferences:setLocale({locale})` throws `UNSUPPORTED_LOCALE`.
  - The web uses `useAccountLocaleSync.ts` and `useLanguageSetting.ts`.
  - Neither native app reads the language today.
- **Apple:**
  - iOS and macOS 26 (`apps/apple/project.yml:4-6`), `developmentLanguage: en`.
  - No `.xcstrings`, `.strings` or `.lproj` files.
  - About 445 unique hard-coded strings across 71 Swift files. Many are built as `String` in TeakCore (for example `Tags.swift:44` with an `en_US` locale, `CardFacts.swift:18-29` concatenating the done sentence), so SwiftUI can't localize them automatically.
  - Strings in TeakCore and TeakUI need `bundle: .module`.
  - The Safari extension has `_locales/en` only, with 2 keys.
  - Convex function names are listed in `ConvexFunctions.swift`.
- **Android:**
  - minSdk 31, target 37 (`build-logic/convention/src/main/kotlin/TeakAndroid.kt:13-14`).
  - 5 strings in 3 `strings.xml` files; about 417 unique hard-coded strings in 108 Kotlin files.
  - No `locales_config.xml`, no `android:localeConfig`, no AppCompat (`MainActivity : ComponentActivity`).
  - Function names live in `core/data/.../convex/ConvexFunctions.kt:25-58`.
  - `LinkState.kt:22-30` concatenates the done sentence.
- **Done verbs:** `packages/convex/shared/linkCategories.ts:80-131` is the source of truth. `apps/apple/scripts/shared-constants.ts:64` and `apps/android/scripts/shared-constants.ts:82` generate it into both apps. Raycast keeps a hand copy in `apps/raycast/src/lib/doneStates.ts:15`.

### Wording today

| Action | Web | Apple | Android | Raycast | Safari popup |
|---|---|---|---|---|---|
| Sign out | Sign out | **Log Out** | **Log Out** | Sign Out | Sign Out |
| Trash one card | Delete (menu), Move to Trash (bulk) | Delete, **Delete Card**, Move to Trash | Move to Trash | Move to Trash | – |
| Similar | More like this | More Like This | More like this | **Find Similar** | – |
| Archive | Archive | Archive | Archive | **Archive Card** | – |
| Favorite | Favorite / Unfavorite | same | same | **Add Favorite / Remove Favorite** | – |
| Refresh | Refresh details | Refresh Details | Refresh details | Refresh Details | – |
| Done | Mark as read / Read / Mark as not read | same, plus a "Mark as Done" fallback | same | Mark as Read / Mark as Not Read | – |

## Decisions

- **One English source.** Native text goes into `packages/i18n/messages/*.json` under new namespaces:
  - `native.*` for text both apps share (settings, card sections, menus, errors);
  - `apple.*` and `android.*` for platform-only text (Mac menu commands, Safari extension setup, the upload notification, permission prompts).
  - Reuse an existing web key only when its meaning is identical.
- **Generated, not hand-kept.** A script per app, next to `shared-constants.ts`, generates the platform's own format. The generated files are committed and a test fails on drift, like the shared constants. Messages that use only placeholders and plurals in the `native`, `apple` and `android` namespaces convert as follows:
  - **Apple:** one `Localizable.xcstrings` for the app, one for the share extension, one in the TeakKit package (`bundle: .module`), plus `InfoPlist.xcstrings`. ICU `{count, plural, …}` becomes xcstrings plural variations, and `{name}` becomes `%@`.
  - **Android:** `res/values-<locale>/strings.xml` per module, with ICU plurals as `<plurals>`, and `locales_config.xml` with `android:localeConfig`.
  - **Safari extension:** its `_locales/<dir>/messages.json`, using `extensionLocaleDir`.
- **No ICU select or rich text in native namespaces.** A new check in `scripts/i18n-catalog.test.ts` rejects them. Where the web uses a select (the done verbs), native gets one key per verb (`native.done.markAs.read`, `…watched`, …), picked from the shared verb map. The sentence is never concatenated.
- **Capitalization:**
  - English native text is sentence case, like the web.
  - Mac menu-bar command titles (`TeakCommands.swift`) keep Title Case in `apple.commands.*`, since macOS menus expect it.
  - Other languages follow their own case rules (glossary).
- **Account is the source of truth.**
  - On sign-in and on every foreground, the app reads `getPreferences` and applies the language.
  - The in-app picker calls `setLocale` and applies the language right away, with Undo as on the web.
  - A change made in the system's per-app language list is written to the account on the next foreground, after comparing it with the last value the app applied.
  - Signed out, the app follows the system language.
- **Android per-app language:** `LocaleManager` on API 33+. On API 31–32, the in-app picker applies the language by wrapping the activity's context. The system list doesn't exist there. Default: no AppCompat. Add `androidx.appcompat` only if wrapping breaks Compose resources.
- **Formats:**
  - Apple: dates and numbers use `.formatted()` with the app's locale.
  - Android: `DateTimeFormatter.ofLocalizedDate` / `NumberFormat` with the app locale.
  - Remove fixed `en_US` / `Locale.US` formatting except for machine-readable values.
- **Wording:** the canonical labels, applied on every client in this PR:
  - Sign out.
  - **Move to Trash** for putting a card in Trash. Everywhere, including the web's card menu and modal, which say "Delete" today. "Delete forever" stays for the permanent action.
  - More like this. Archive / Unarchive. Favorite / Unfavorite. Refresh details.
  - Mark as read / watched / listened / bought / cooked / played / done, and "Mark as not …" to undo.
  - Raycast's labels change to the same words in Title Case (Raycast's own convention). `doneStates.ts` is generated from `linkCategories.ts`, not hand-kept.
- **Not translated:** "Teak", "Pro", search syntax, and server-made card text (link facts, bylines), as on the web.

## Work

1. **i18n package:**
   - Add the `native`, `apple` and `android` namespaces in English.
   - Add the select/rich-text check.
   - Add the generators (`apps/apple/scripts/i18n.ts`, `apps/android/scripts/i18n.ts`) and their drift tests. Wire both into the existing `shared-constants` scripts.
2. **Apple:**
   - Extract every string from Teak, ShareExtension, SafariExtension and the TeakKit sources.
   - Make TeakCore helpers take a `Locale`.
   - Add `LanguageSettings` (a Settings row on iOS, the General tab on Mac) and `PreferencesModel`, which reads and writes the account. Add `getPreferences`/`setLocale` to `ConvexFunctions`.
   - Run `apps/apple/scripts/generate-project.sh` and commit `Teak.xcodeproj`.
3. **Android:**
   - Extract strings into each module's `strings.xml`.
   - Add a Language row in Settings, a `PreferencesRepository` for the account language, and the `ConvexFunctions` entries.
   - Add `locales_config.xml` and the manifest attribute.
4. **Wording:** apply the table on web (`en.json` plus the 7 other catalogs), Apple, Android, Raycast and the Safari popup.
5. **Translations:** translate the new keys into the 7 other catalogs following the glossary. The owner spot-checks them.
6. **Docs:**
   - `translating.mdx`: native apps are localized, and how to add a native string.
   - `features.mdx` → Language: where to change it on each app.
   - `apps/docs/content/docs/(apps)/mobile.mdx` and `mac.mdx`.
7. **Verify recipes:**
   - Update `features/language.md`, `features/apple.md` and `features/android.md`.
   - Add `apple-language` and `android-language` sub-features.

## Tests

- `scripts/i18n-catalog.test.ts`: the native namespaces exist in all 8 catalogs, have no select or rich text, and the generated files match.
- Apple (TeakCoreTests): plural rules for "card(s)" in en, ja and de; done sentences for every verb; and an account language that differs from the system's wins.
- Android (unit tests): the same cases, plus `locales_config.xml` listing exactly `SUPPORTED_LOCALES`.
- Web: existing tests pass with the new "Move to Trash" label. Update `packages/tests` specs that click "Delete".

## Proof (private artifact page, linked under Proof)

- **Before and after:** English screenshots of each app's main screens. The only differences should be the wording changes.
- **Japanese and German:** screenshots on iPhone, iPad, Mac, Android phone and tablet, light and dark. Cover:
  - the library, a link card, a note card, Settings, Tags and the bulk bar;
  - the share sheet;
  - an empty state and the card-limit message;
  - the Safari popup.
- **Videos:**
  - Switching to German on the web, then opening the iPhone and Android apps in German.
  - Switching to Japanese in the native Settings, then the web reloading in Japanese.
  - Choosing French in iOS Settings → Teak → Language and in Android's per-app language, then `getPreferences` reading `fr`.
- **Captured output:** the catalog test passing, and failing on a removed native key; the generator drift test failing on a hand-edited `.xcstrings`.
- **Wording:** a table of screenshots, one label per client, showing the canonical words.

## Release gate

1. Run `bun run check` and the Apple and Android local builds (`apps/apple/AGENTS.md`, `apps/android/AGENTS.md`).
2. Deploy web (wording) first. Then release Apple and Android through their runbooks at one lockstep version, and publish Raycast.
3. In production, switch the owner's account to German and back on each app.

## Risks and open questions

- **Size:** about 860 strings across two apps. Commit per app and module so review can go one commit at a time, with the catalogs last.
- **Translation quality:** the owner spot-checks only the main screens, as for the web.
- **Open:** whether Apple's iOS buttons keep Title Case. Default: sentence case everywhere except Mac menu commands.
- **Open:** whether the Safari popup follows the account language (it can't read it before sign-in). Default: it follows the browser's language, like store listings.
