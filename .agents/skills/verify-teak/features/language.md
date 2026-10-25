# Language

A user picks Teak's language in the web app's Settings → Appearance → Language, or the Apple and Android apps' Settings → Language: English, Español, Português (Brasil), Deutsch, Français, 日本語, 한국어 or 简体中文. The app switches in place without a reload, a toast "Language changed" (in the new language) offers Undo, and the choice is saved to the account, so another browser signed in to the same account follows it. Dates, numbers and plurals follow the language; search syntax (`is:fav`, `type:image`, `OR`) stays English. The browser extension follows the account's language once signed in, and `/v1/me` returns `locale`. In development, `?__locale=en-XA` shows the pseudo-locale, which wraps every catalog string as `[Šéţţîñĝš ~~~]`.

## Sub-features

- `language-row` lists the eight languages by their own names, with the English name beside each, under Theme on Settings → Appearance.
- `language-switch` re-renders the open page in the chosen language within a second, keeps the route and scroll, sets `<html lang>`, and shows "Language changed" with Undo.
- `language-persist` saves the choice to the account: a reload, a second browser and `/v1/me` all read it. The account wins over a stale `teak-locale` cookie.
- `language-formats` formats dates, counts and plurals in the language (`1 Karte`, `2 Karten`; one form in ja, ko, zh-Hans).
- `language-errors` shows known server errors (folder, tag, card limit) in the language, and falls back to the server's English for unknown ones.
- `language-pseudo` (development only) renders `en-XA` from the cookie or `?__locale=en-XA`, to find untranslated text, clipping and overflow.
- `language-api` returns `locale` from `GET /v1/me`, `me().locale` in the SDK and "Language: Deutsch" in `teak whoami`. No API, MCP or CLI command sets it.
- `language-sign-out` clears the cookie on sign-out, so the next account starts from its own language.
- `apple-language` (iPhone, iPad, Mac) lists the eight languages in Settings → Language (the General tab on Mac), switches the app at once with "Language changed" and Undo under the row, and saves to the account; the web follows. A language set on the web reaches the running app within seconds. Choosing a language in iOS Settings → Apps → Teak → Language (macOS: Language & Region → Applications) relaunches the app in it and saves it to the account. The share extension and the Safari extension's native replies use the app's language; the Safari popup's own labels follow Safari's.
- `android-language` (phone and tablet) lists the eight languages in Settings → Language, switches at once with a "Language changed" snackbar and Undo, and saves to the account. On Android 13 and later, Settings → Apps → Teak → Language lists the same eight and a choice there is saved to the account when the app next starts. Android 12 has no system list; the in-app choice recreates the screen in the language.

## How to get to it (user POV)

- Settings → Appearance (`/settings/appearance`) → the section "Language" under "Theme" → the select.
- After a switch: the toast's "Undo" (its label is in the new language, such as "Rückgängig").
- Development: any app URL with `?__locale=en-XA`.
- `teak whoami`, `GET /v1/me`.
- iPhone and iPad: Settings tab → Language; iOS Settings → Apps → Teak Dev → Language. Mac: Settings (⌘,) → General → Language; System Settings → General → Language & Region → Applications.
- Android: Settings → Appearance → Language; system Settings → Apps → Teak Dev → Language.

## Driving it with e2e MCP

Preconditions:

- English first: if the account isn't English, set it back in Settings → Appearance → Language before starting, and again when done.
- For `language-persist`, seed the pack from `packages/convex`: `bunx convex run devSeed:seedScenario '{"workosUserId":"<id>","scenario":"locale-switch"}'`, with the id from `.agents/.state/dev-account.json`. It sets the account to German and adds no cards.

Steps:

- **Row.** `navigate` to `/settings/appearance`. A combobox named "Language" shows "English". Open it: eight options, "Deutsch German" … "简体中文 Chinese (Simplified)", each with its `lang`. Screenshot.
- **Switch.** Pick "Deutsch". Without a navigation, the row titles read "Design" and "Sprache", the toast reads "Sprache geändert" with "Rückgängig", and `document.documentElement.lang` is `de` (`call` evaluate). Go to `/`: the sidebar and search placeholder are German. Reload: still German.
- **Undo.** Switch to "日本語", then press the toast's undo button: back to German, the toast says so in German.
- **Persistence.** `GET $SITE/v1/me` with the key from `scripts/api-key.ts`: `"locale":"de"`. `bun apps/cli/src/index.ts whoami`: a line "Language: Deutsch".
- **Account wins.** Seed `locale-switch`, set the cookie to `ja` (`document.cookie = "teak-locale=ja; path=/"`) and reload: the first paint may be Japanese, then the page settles in German within a second and the cookie reads `teak-locale=de`.
- **Formats.** In German, select one card, then two: the bar reads "1 Karte ausgewählt", then "2 Karten ausgewählt". Open a link card: its dates are German ("24. Okt. 2026"). Search `is:fav type:image`: the pills work, and the qualifier text stays English.
- **Errors.** Create a folder named with 81 characters: the error is the German translation of the length limit.
- **Every language.** Switch through all eight on `/`, a card dialog (link and note) and every Settings page, at 390 and 1440 px, light and dark; screenshot each for the owner's spot check.
- **Pseudo-locale (break it).** `navigate` to `/?__locale=en-XA`. Every catalog string is bracketed and accented. Walk the sidebar, grid, a card dialog for each type, Settings, Tags, Trash, Archive, folders, search suggestions and pills, the command palette (`⌘K`), `?`, the bulk bar at 390 px and a few toasts. Any plain English that isn't server-made (link facts, bylines, import errors) or search syntax is a missed string; any clipped button, overflow or wrapped toolbar is a layout bug. Clear with Settings → Appearance → Language → English.
- **Sign-out.** Switch to Deutsch, sign out: `document.cookie` has no `teak-locale`. Sign back in: German again, from the account.
- **Apple.** Build and sign in as in [apple](./apple.md). Settings → Language → Deutsch: every screen is German at once (tabs, library, a card, the share sheet), and the footer offers "Rückgängig". `GET /v1/me` reads `"locale":"de"`; the web, reloaded, is German. Switch the web to 日本語: the app turns Japanese within seconds. In iOS Settings → Apps → Teak Dev → Language pick Français: the app relaunches in French and `/v1/me` reads `"fr"`. Check plurals in the bulk bar ("1 Karte", "2 Karten"), dates on a link card, and Mac menu commands. Screenshot iPhone, iPad and Mac in de and ja, light and dark.
- **Android.** Build and sign in as in [android](./android.md). Settings → Language → Deutsch: the screen re-renders in German and a snackbar offers "Rückgängig"; `/v1/me` reads `"de"`. Switch the web to 日本語: the app follows within seconds. `adb shell am start -a android.settings.APP_LOCALE_SETTINGS -d package:com.praveenjuge.teak.debug` → Français: reopen the app, it's French and `/v1/me` reads `"fr"`. Check the share sheet and the upload notification. Screenshot phone and tablet in de and ja, light and dark.
- **End to end (local stack).** `bun run --cwd packages/tests e2e src/web/language.e2e.ts src/web/i18n-pseudo.e2e.ts`.
- **Clean up.** Settings → Appearance → Language → English, and check `GET /v1/me` says `"locale":"en"`.

## Gotchas

- The pseudo-locale is development only: production ignores both the cookie value and the parameter. It is never saved to the account, so the Language select shows English while it is on.
- The 404 page and the root error page render in English first, then switch once the browser reads the cookie.
- Server-made text stays English in every language: link facts, bylines, price labels, import errors, connection names in Security ("Chrome extension"), and the API, MCP and CLI.
- Also English on purpose: browser tab titles (route metadata renders before the language is known), the toast region's screen-reader label "Notifications", and key names in shortcuts (Esc, Enter, Ctrl, Del).
- The extension's name in the browser follows the browser's language, not the account's.
- A second tab follows a language change on its next query update or reload, not instantly.
- The native apps start in the account's language once signed in, so an account that never chose one is English even on a German device; signed out they follow the device.
- The Mac Debug app shares `com.praveenjuge.teak` with an installed Teak, so a language run writes `AppleLanguages`, `teak.language.applied` and possibly `teak.language.pending` there and `teak.language` in the `group.com.praveenjuge.teak` group container. Delete all three after the run (`defaults delete com.praveenjuge.teak AppleLanguages`, the same for `teak.language.applied` and `teak.language.pending`, and `PlistBuddy -c "Delete :teak.language"` on the group plist).
- Android asks for a region after a language with several regions (Français → France); the app maps it back to Teak's language.
- To change the account's language from outside a native app without the web, call `settings/preferences:setLocale` over the local backend's `/api/mutation` with the test session's access token (the Apple launch environment's `TEAK_UI_TEST_SESSION`), as another client would.
- iOS and macOS apply a per-app language to system controls (share sheets, pickers, system alerts) only after a relaunch; Teak's own text switches at once.
