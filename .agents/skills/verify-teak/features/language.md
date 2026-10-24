# Language

A user picks the web app's language in Settings → Language: English, Español, Português (Brasil), Deutsch, Français, 日本語, 한국어 or 简体中文. The app switches in place without a reload, a toast "Language changed" (in the new language) offers Undo, and the choice is saved to the account, so another browser signed in to the same account follows it. Dates, numbers and plurals follow the language; search syntax (`is:fav`, `type:image`, `OR`) stays English. The browser extension follows the account's language once signed in, and `/v1/me` returns `locale`. In development, `?__locale=en-XA` shows the pseudo-locale, which wraps every catalog string as `[Šéţţîñĝš ~~~]`.

## Sub-features

- `language-row` lists the eight languages by their own names, with the English name beside each, under Theme in Settings, plus a "Help improve translations" mail link.
- `language-switch` re-renders the open page in the chosen language within a second, keeps the route and scroll, sets `<html lang>`, and shows "Language changed" with Undo.
- `language-persist` saves the choice to the account: a reload, a second browser and `/v1/me` all read it. The account wins over a stale `teak-locale` cookie.
- `language-formats` formats dates, counts and plurals in the language (`1 Karte`, `2 Karten`; one form in ja, ko, zh-Hans).
- `language-errors` shows known server errors (folder, tag, card limit) in the language, and falls back to the server's English for unknown ones.
- `language-pseudo` (development only) renders `en-XA` from the cookie or `?__locale=en-XA`, to find untranslated text, clipping and overflow.
- `language-api` returns `locale` from `GET /v1/me`, `me().locale` in the SDK and "Language: Deutsch" in `teak whoami`. No API, MCP or CLI command sets it.
- `language-sign-out` clears the cookie on sign-out, so the next account starts from its own language.

## How to get to it (user POV)

- Settings → the "Language" row under "Theme" → the select.
- After a switch: the toast's "Undo" (its label is in the new language, such as "Rückgängig").
- Development: any app URL with `?__locale=en-XA`.
- `teak whoami`, `GET /v1/me`.

## Driving it with e2e MCP

Preconditions:

- English first: if the account isn't English, set it back in Settings → Language before starting, and again when done.
- For `language-persist`, seed the pack from `packages/convex`: `bunx convex run devSeed:seedScenario '{"workosUserId":"<id>","scenario":"locale-switch"}'`, with the id from `.agents/.state/dev-account.json`. It sets the account to German and adds no cards.

Steps:

- **Row.** `navigate` to `/settings`. A combobox named "Language" shows "English". Open it: eight options, "Deutsch German" … "简体中文 Chinese (Simplified)", each with its `lang`. Screenshot.
- **Switch.** Pick "Deutsch". Without a navigation, the row titles read "Design" and "Sprache", the toast reads "Sprache geändert" with "Rückgängig", and `document.documentElement.lang` is `de` (`call` evaluate). Go to `/`: the sidebar and search placeholder are German. Reload: still German.
- **Undo.** Switch to "日本語", then press the toast's undo button: back to German, the toast says so in German.
- **Persistence.** `GET $SITE/v1/me` with the key from `scripts/api-key.ts`: `"locale":"de"`. `bun apps/cli/src/index.ts whoami`: a line "Language: Deutsch".
- **Account wins.** Seed `locale-switch`, set the cookie to `ja` (`document.cookie = "teak-locale=ja; path=/"`) and reload: the first paint may be Japanese, then the page settles in German within a second and the cookie reads `teak-locale=de`.
- **Formats.** In German, select one card, then two: the bar reads "1 Karte ausgewählt", then "2 Karten ausgewählt". Open a link card: its dates are German ("24. Okt. 2026"). Search `is:fav type:image`: the pills work, and the qualifier text stays English.
- **Errors.** Create a folder named with 81 characters: the error is the German translation of the length limit.
- **Every language.** Switch through all eight on `/`, a card dialog (link and note) and `/settings`, at 390 and 1440 px, light and dark; screenshot each for the owner's spot check.
- **Pseudo-locale (break it).** `navigate` to `/?__locale=en-XA`. Every catalog string is bracketed and accented. Walk the sidebar, grid, a card dialog for each type, Settings, Tags, Trash, Archive, folders, search suggestions and pills, the command palette (`⌘K`), `?`, the bulk bar at 390 px and a few toasts. Any plain English that isn't server-made (link facts, bylines, import errors) or search syntax is a missed string; any clipped button, overflow or wrapped toolbar is a layout bug. Clear with Settings → Language → English.
- **Sign-out.** Switch to Deutsch, sign out: `document.cookie` has no `teak-locale`. Sign back in: German again, from the account.
- **End to end (local stack).** `bun run --cwd packages/tests e2e src/web/language.e2e.ts src/web/i18n-pseudo.e2e.ts`.
- **Clean up.** Settings → Language → English, and check `GET /v1/me` says `"locale":"en"`.

## Gotchas

- The pseudo-locale is development only: production ignores both the cookie value and the parameter. It is never saved to the account, so the Language select shows English while it is on.
- The 404 page and the root error page render in English first, then switch once the browser reads the cookie.
- Server-made text stays English in every language: link facts, bylines, price labels, import errors, connection names in Security ("Chrome extension"), and the API, MCP and CLI.
- Also English on purpose: browser tab titles (route metadata renders before the language is known), the toast region's screen-reader label "Notifications", and key names in shortcuts (Esc, Enter, Ctrl, Del).
- The extension's name in the browser follows the browser's language, not the account's.
- A second tab follows a language change on its next query update or reload, not instantly.
