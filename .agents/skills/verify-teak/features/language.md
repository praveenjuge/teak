# Language

A user picks Teak's language in Settings on the web, Apple and Android apps: English, Español, Português (Brasil), Deutsch, Français, 日本語, 한국어 or 简体中文. It switches in place and saves to the account. Search syntax (`is:fav`, `type:image`, `OR`) stays English. The browser extension follows the account's language once signed in.

## Sub-features

- `language-row` lists the eight languages by their own names, each with its name in the UI's language beside it (none beside the UI's own language).
- `language-switch` re-renders the open page within a second, keeping route and scroll, sets `<html lang>`, and shows "Language changed" with Undo.
- `language-persist` saves the choice to the account, read by a reload, a second browser and `/v1/me`; it wins over a stale `teak-locale` cookie.
- `language-formats` formats dates, counts and plurals in the language (`1 Karte`, `2 Karten`; one form in ja, ko, zh-Hans).
- `language-errors` translates known server errors (folder, tag, card limit) and shows unknown ones in the server's English.
- `language-pseudo` (development only) renders `en-XA` from the cookie or `?__locale=en-XA`, wrapping every catalog string as `[Šéţţîñĝš ~~~]` to expose untranslated text, clipping and overflow.
- `language-api` returns `locale` from `GET /v1/me`, `me().locale` in the SDK and "Language: Deutsch" in `teak whoami`. No API, MCP or CLI command sets it.
- `language-sign-out` clears the cookie on sign-out, so the next account starts in its own language.
- `apple-language` (iPhone, iPad, Mac) does the same in Settings → Language, with Undo under the row, synced with the account both ways; a system per-app language relaunches the app in it and is saved. The share extension and the Safari extension's native replies use the app's language; the Safari popup's labels follow Safari's.
- `android-language` (phone and tablet) does the same in Settings → Language, with a "Language changed" snackbar and Undo. On Android 13+ a choice in the system's per-app list is saved to the account at next start; Android 12 has none, and the in-app choice recreates the screen.

## How to get to it (user POV)

- Settings → Appearance (`/settings/appearance`) → "Language", under "Theme".
- After a switch: the toast's Undo, labelled in the new language ("Rückgängig").
- Development: any app URL with `?__locale=en-XA`.
- `teak whoami`, `GET /v1/me`.
- iPhone and iPad: Settings tab → Language; iOS Settings → Apps → Teak Dev → Language. Mac: Settings (⌘,) → General → Language; System Settings → General → Language & Region → Applications.
- Android: Settings → Appearance → Language; system Settings → Apps → Teak Dev → Language.

## Driving it with e2e MCP

Preconditions:

- Start in English: if the account isn't, switch it in Settings → Appearance → Language.
- For `language-persist`, seed the pack from `packages/convex`: `bunx convex run devSeed:seedScenario '{"workosUserId":"<id>","scenario":"locale-switch"}'`, with the id from `.agents/.state/dev-account.json`. It sets the account to German and adds no cards.

Steps:

- **Row.** On `/settings/appearance`, combobox "Language" shows "English". Open it: listbox "Language" has eight options, each with its `lang`, from "English" (no second name) to "简体中文 Chinese (Simplified)", among them "Deutsch German". Screenshot. In Deutsch it lists "English Englisch", "Deutsch" with no second name, "Français Französisch" and "简体中文 Chinesisch (Vereinfacht)".
- **Switch.** Pick "Deutsch". Without a navigation, the row titles read "Design" and "Sprache", the toast reads "Sprache geändert" with "Rückgängig", and `document.documentElement.lang` is `de` (`call` evaluate). On `/` the sidebar and search placeholder are German, and stay so after a reload.
- **Undo.** Switch to "日本語", then the toast's undo: back to German, announced in German.
- **Persistence.** `GET $SITE/v1/me` (key from `scripts/api-key.ts`): `"locale":"de"`. `bun apps/cli/src/index.ts whoami`: a line "Language: Deutsch".
- **Account wins.** Seed `locale-switch`, set the cookie to `ja` (`document.cookie = "teak-locale=ja; path=/"`) and reload: the first paint may be Japanese, then within a second the page is German and the cookie reads `teak-locale=de`.
- **Formats.** In German, select one card, then two: the bar reads "1 Karte ausgewählt", then "2 Karten ausgewählt". A link card's dates are German ("24. Okt. 2026"). Search `is:fav type:image`: the pills work and the qualifier text stays English.
- **Errors.** Create a folder with an 81-character name: the length-limit error is in German.
- **Every language.** Switch through all eight on `/`, a card dialog (link and note) and every Settings page, at 390 and 1440 px, light and dark; screenshot each.
- **Pseudo-locale (break it).** `navigate` to `/?__locale=en-XA`: every catalog string is bracketed and accented. Walk the sidebar, grid, a card dialog for each type, Settings, Tags, Trash, Archive, folders, search suggestions and pills, the command palette (`⌘K`), `?`, the bulk bar at 390 px and a few toasts. Plain English that isn't server-made (see Gotchas) or search syntax is a missed string; a clipped button, overflow or wrapped toolbar is a layout bug. Clear with Settings → Appearance → Language → English.
- **Sign-out.** In Deutsch, sign out: `document.cookie` has no `teak-locale`. Sign back in: German again.
- **Apple.** Build and sign in as in [apple](./apple.md). Settings → Language → Deutsch: every screen (tabs, library, a card, the share sheet) is German at once and the footer offers "Rückgängig". `GET /v1/me` reads `"locale":"de"` and the reloaded web is German. Switch the web to 日本語: the app turns Japanese within seconds. In iOS Settings → Apps → Teak Dev → Language pick Français: the app relaunches in French and `/v1/me` reads `"fr"`. Check bulk-bar plurals ("1 Karte", "2 Karten"), link-card dates and Mac menu commands. Screenshot iPhone, iPad and Mac in de and ja, light and dark.
- **Android.** Build and sign in as in [android](./android.md). Settings → Language → Deutsch: the screen re-renders in German with a "Rückgängig" snackbar; `/v1/me` reads `"de"`. Switch the web to 日本語: the app follows within seconds. `adb shell am start -a android.settings.APP_LOCALE_SETTINGS -d package:com.praveenjuge.teak.debug` → Français: reopen the app, it's French and `/v1/me` reads `"fr"`. Check the share sheet and the upload notification. Screenshot phone and tablet in de and ja, light and dark.
- **End to end (local stack).** `bun run --cwd packages/tests e2e src/web/language.e2e.ts src/web/i18n-pseudo.e2e.ts`.
- **Clean up.** Settings → Appearance → Language → English, and check `GET /v1/me` says `"locale":"en"`.

## Gotchas

- Production ignores the pseudo-locale's cookie and parameter. It is never saved to the account, so the Language select shows English while it is on.
- The 404 page and the root error page render in English first, then switch once the browser reads the cookie.
- Server-made text stays English in every language: link facts, bylines, price labels, import errors, connection names in Security ("Chrome extension"), and the API, MCP and CLI.
- Signed-in pages title the browser tab in the UI language (Tags, Archive, Trash, Favorites, each Settings page). English on purpose: tab titles outside the signed-in app ("Page not found", the open-link page), the toast region's screen-reader label "Notifications", and key names in shortcuts (Esc, Enter, Ctrl, Del).
- The extension's name follows the browser's language, not the account's.
- A second tab follows a change on its next query update or reload, not instantly.
- Signed in, the native apps use the account's language, so an account that never chose one is English even on a German device; signed out they follow the device.
- The Mac Debug app shares `com.praveenjuge.teak` with an installed Teak, so after a language run `defaults delete com.praveenjuge.teak` each of `AppleLanguages`, `teak.language.applied` and `teak.language.pending`, and run `PlistBuddy -c "Delete :teak.language"` on the `group.com.praveenjuge.teak` group container's plist.
- Android asks for a region after a language with several regions (Français → France); the app maps it back to Teak's language.
- To change the account's language without the web or a native app, call `settings/preferences:setLocale` over the local backend's `/api/mutation` with the test session's access token (the Apple launch environment's `TEAK_UI_TEST_SESSION`).
- iOS and macOS apply a per-app language to system controls (share sheets, pickers, system alerts) only after a relaunch.
