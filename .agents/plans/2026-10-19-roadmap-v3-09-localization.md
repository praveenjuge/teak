## Goal

Let people use Teak's web app and browser extension in Spanish, Portuguese (Brazil), German, French, Japanese, Korean and Chinese, as well as English. Phase 9 of the [roadmap v3](2026-10-19-roadmap-v3-00-roadmap.md). In one PR, this phase:
- picks an i18n library;
- moves every user-facing string in `apps/web` and `apps/extension` into an English message catalog;
- routes dates and numbers through locale-aware formatters;
- carries the locale without putting it in the URL;
- adds checks that stop new hardcoded strings and incomplete catalogs;
- adds the seven translated catalogs and a Settings → Language row. The choice is saved to the account, and the extension follows it.

Catalogs are translated by AI and spot-checked by the owner, and CI keeps them complete. English looks exactly as it does today.

## Depends on

- Nothing in v3. It runs after phases 1–8 in the roadmap order so that their new strings are extracted once. Strings added later must go through the catalog, in every language, from the start.

## Success Criteria

### Foundation

- **Library and catalog:** one library serves Next.js (server and client components) and the WXT extension's React popup. The shared English catalog lives in one place.
- **Nothing visible changes in English:** screenshot diffs of the main screens show no change.
- **The pseudo-locale** `en-XA` works only in development, set by a cookie or the `?__locale=en-XA` parameter (a dev-only exception to "no locale in URLs"; production ignores the parameter). In the extension, a dev build reads an `en-XA` override from `chrome.storage.local` (set from the popup's dev menu), which the popup, the background's context menus and the omnibox all follow. It wraps every string as `[Ŝéţţîñĝš ~~~~]` and lengthens it by about 40%. Every screen in the break-it list renders with no un-wrapped English, no clipped buttons and no overflow at 390 px.
- **Dates and numbers** go through formatters keyed on the active locale. No `"en-US"` literal is left in `apps/web`. While the UI language is English, each formatter keeps the locale it uses today: the browser's locale where the code calls `toLocaleDateString()` with no locale, and `en-US` where it is hardcoded. So English output doesn't change for anyone; another UI language uses that language. A test renders a date with the UI in English and the browser in `de-DE` and checks it matches today's output.
- **`<html lang>`** follows the active locale in every HTML root: `layout.tsx`, `global-error.tsx` (it replaces the root layout, so it reads the cookie and loads its few messages itself; `<html lang="en">` at line 41 today), and the extension popup, whose static `index.html` says `lang="en"`, so the popup sets `document.documentElement.lang` once the stored locale is loaded.
- **CI fails when:**
  - a non-English catalog has missing or extra keys, or ICU placeholders that don't match English;
  - a new JSX string literal is added in the covered paths.
- **Nothing in the search syntax or stored card data changes.** The only API change is `locale` in `/v1/me`.

### Languages

- **The setting:** Settings has a "Language" row under Theme, with a select listing each language in its own name:
  - English
  - Español
  - Português (Brasil)
  - Deutsch
  - Français
  - 日本語
  - 한국어
  - 简体中文

  Changing it saves to the account, re-renders the app in that language within one second, without a full reload or losing the current view, and sets `<html lang>`.
- **The default** is English for every account, including existing ones. The browser's language is never used, as the owner decided.
- **Everywhere it applies:** every extracted string, and dates, numbers and plurals, appear in the chosen language on every web screen and in the extension: popup, context menus, inline save buttons and omnibox suggestions. The extension reads the account's language after sign-in.
- **The catalogs:** `es.json`, `pt-BR.json`, `de.json`, `fr.json`, `ja.json`, `ko.json` and `zh-Hans.json` exist, and the catalog check passes: same keys, same placeholders, valid ICU.
- **Store listings:** the extension's manifest name and description and its Chrome Web Store listing text exist in all seven languages.
- **What stays English:**
  - search syntax and qualifiers (`is:fav`, `type:image`, date words);
  - server-made text stored on cards (link facts, bylines);
  - the docs site and emails.

  Suggestion labels and pills are translated.
- **AI process:** a guide tells agents to translate every new English key into all seven catalogs in the same PR, using the glossary. CI fails when a catalog is missing a key.

## Context And Current Facts

- **Versions:**
  - `apps/web` uses `next` 16.4.0 with `reactCompiler: true` (`apps/web/next.config.ts:56`).
  - React is 19.3.0 (root `package.json:49-50`).
  - The extension uses `wxt` ^0.21.3 and `@wxt-dev/module-react` (`apps/extension/package.json:32-35`), and keeps its own copies of the button and wordmark (`apps/extension/components/`); it shares no UI package with the web app.
- **No i18n library or catalog anywhere** in web, extension or docs.
  - `apps/web/src/app/layout.tsx:48` hardcodes `lang="en"`.
  - The WXT extension has no `_locales`. The separate Safari extension in `apps/apple/SafariExtension` has `_locales/en/messages.json` and is out of scope.
- **Hardcoded strings:** about 340 JSX text lines and 57 toast calls across about 149 `.tsx` files in `apps/web`, plus aria-labels, titles and placeholders. The extension popup's `App.tsx` alone is 566 lines.
- **Hardcoded `"en-US"`:**
  - `apps/web/src/components/card-modal/cardHeading.ts:63`
  - `apps/web/src/components/card-modal/cardDetails.ts:6,79`
  - `apps/web/src/lib/exif.ts:64`
  - `apps/web/src/lib/linkByline.ts:62`
  - Convex-side: `shared/search/qualifiers.ts:209` (price labels), `shared/utils/timeSearch.ts:79,86`, `workflows/steps/categorization/providers/common.ts:88,123` (facts stored on cards), `import/csv.ts:52`, `linkMetadata/x.ts:138` and `linkMetadata/socialPostHelpers.ts:123` (bylines stored on cards).
  - About 18 files in ui, web and the extension call `toLocaleString`, `toLocaleDateString` or `Intl.*` without a locale, for example `TagsScreen.tsx` `cardCountLabel`.
- **Server error messages** reach toasts as English text: `FOLDER_ERROR_MESSAGES` (`shared/folders.ts`), `TAG_ERROR_MESSAGES` (`shared/tags.ts`), `THUMBNAIL_ERROR_MESSAGES`, and `ConvexError({ code, message })`. Most carry a `code`.
- **Linting:** Biome 2.5.15 through ultracite 7.12.0 (`biome.json`). It has a `noJsxLiterals` rule (`configuration_schema.json`), and the repo already uses GritQL plugins (`scripts/lint/*.grit`).
- **No preference storage today.** The `users` table (`packages/convex/schema.ts:529-541`) holds only identity fields. Theme is per device, through `ThemeToggle` (`apps/web/src/components/settings/SettingsContent.tsx:192-194`); Language goes next to it.
- **`/v1/me`** (`packages/convex/publicApiMe.ts`, `profileForOwner` 14–27) returns email, plan and optionally `cardCount`. The extension calls it in `getOAuthState` (`apps/extension/lib/oauthAuth.ts:458`).
- The extension's context menus are created in `entrypoints/background.ts` (around 476), and its inline buttons in `entrypoints/content/platforms/*`.
- The extension is released through `apps/extension/release.md`. The first Chrome Web Store and AMO listings were made by hand, and listing text lives in each store's dashboard.

## Library choice

| Option | Fit |
|---|---|
| **next-intl (web) + use-intl (extension)**, the default | One ICU message format and one `useTranslations` / `useFormatter` API everywhere. next-intl supports App Router without i18n routing, with the locale read from a cookie in `i18n/request.ts`. use-intl's `IntlProvider` is plain React, so it works in the WXT popup. Message keys are plain JSON, so AI translation and key checks are simple. No compiler plugin, so it doesn't interact with the React Compiler |
| Lingui | Good extraction from macros, but needs its SWC plugin for Next 16.4 and a Babel or Vite macro setup for the extension. That is two build integrations, plus a check that the SWC plugin works alongside the React Compiler. More moving parts |
| react-i18next | Works everywhere, but has a heavier runtime and weaker ICU (a plugin). Its server-component story in Next is DIY |
| Native `Intl` plus a small in-house `t()` | Smallest, but rebuilds plurals, rich text and type-safe keys by hand |

Default: **next-intl / use-intl**. Spend half a day confirming that next-intl's latest release supports Next 16.4 and that `useTranslations` works in a `"use client"` component compiled with the React Compiler, before extracting anything.

## Constraints And Non-goals

- **Scope:** `apps/web` and `apps/extension` only. Not the Apple, Android, Raycast or Safari extension apps, the docs site, or email.
- **Languages:** `es`, `pt-BR`, `de`, `fr`, `ja`, `ko` and `zh-Hans` (Simplified), plus `en`. No Traditional Chinese (see Risks) and no right-to-left languages.
- **No locale in URLs** and no automatic detection. The locale comes from a `teak-locale` cookie, defaulting to `en`.
- **Preference storage:** a new table `userPreferences { userId, locale, updatedAt }` with index `by_userId`. Not a field on `users`, which stays identity-only.
  - It is covered by account deletion (`accountDeletionData.ts` `ancillaryPage`) and seeded in the "complete stages" test. Its batch's `length > 0` joins `ancillaryPage`'s continuation return (`accountDeletionData.ts`, the `return (cardLinks.length > 0 || …)` near line 202), so more than one page of rows is deleted.
- **The cookie** mirrors the account preference for server rendering. The account is the source of truth. On load, a client effect compares the two and, if they differ, writes the cookie and calls `router.refresh()`. Signing out clears the cookie.
- **Search syntax stays English** (`is:fav`, `type:image`, date words in `timeSearch.ts`). Suggestion and pill labels shown to people are translated.
- **Server-made strings stay English in v3:** link facts, bylines, price labels in `qualifiers.ts`, import errors, and Convex `message`s. The web maps known error `code`s to catalog messages and falls back to the server's English text for unknown codes. Those server fallbacks are exempt from the `en-XA` "no unwrapped English" check, which covers only catalog strings.
- **Keys** are namespaced by component (`cardModal.menu.replaceImage`), with ICU plurals (`{count, plural, one {# card} other {# cards}}`), and no string concatenation.
- **No feature flags.** The pseudo-locale is dev-only and stripped from production by `process.env.NODE_ENV`.
- **Translation quality bar:**
  - sentence case where the language has case;
  - "Teak" and qualifiers never translated;
  - the glossary terms used consistently;
  - formal register: `usted` (es), `Sie` (de), `vous` (fr), `você` (pt-BR); polite です/ます (ja); 합니다 / 해요 as the glossary sets it (ko).
- **Analytics:** add `locale_changed { from, to }` first. Add `locale` as a person property (`.agents/analytics.md`).

## Packages and files

- `packages/i18n/` (new workspace, `@teak/i18n`), so the web app and the extension share one catalog without sharing UI code. It joins the lockstep version (`.agents/releases.md`), and the extension's AMO sources zip (`apps/extension/wxt.config.ts`) adds `packages/i18n/**`:
  - `src/locales.ts`: `SUPPORTED_LOCALES = ["en", "es", "pt-BR", "de", "fr", "ja", "ko", "zh-Hans"]`, `DEFAULT_LOCALE`, `isSupportedLocale`, and `LOCALE_COOKIE = "teak-locale"`.
  - `messages/en.json`: the single source catalog for the web app and the extension, plus one file per language.
  - `package.json` exports `"."` (`src/index.ts`) and `"./messages/*"` (`messages/*`), so both apps import the code and load a catalog by locale.
  - `src/pseudo.ts`: builds `en-XA` from `en.json` at runtime in development.
  - `src/format.ts`: `useTeakFormatter()` wrapping use-intl's `useFormatter`, with presets `date.short` ("Oct 19, 2026"), `date.long`, `dateTime`, `number`, `count` and `bytes`. Also a non-hook `formatDate(locale, …)` for helpers called outside React (`cardHeading.ts`, `cardDetails.ts`, `exif.ts`, `linkByline.ts`).
  - `src/errors.ts`: `messageForError(t, code, fallback)` for `CARD_LIMIT_REACHED`, `RATE_LIMITED`, folder and tag codes, thumbnail codes, and `TAG_OPERATION_RUNNING`.
  - `glossary.md` (see AI translation workflow).
  - Depends on `use-intl` only, never on Next.js or WXT.
- `apps/web`:
  - `src/i18n/request.ts` (next-intl `getRequestConfig`): reads the `teak-locale` cookie, checks it with `@teak/i18n`, and loads messages from `@teak/i18n/messages`.
  - `layout.tsx` wraps the app in `NextIntlClientProvider` and sets `<html lang={locale}>`.
  - `next.config.ts` adds the next-intl plugin.
- `apps/extension`:
  - The popup root wraps in `IntlProvider` with the stored locale's catalog (see Extension).
  - Background context-menu titles (`entrypoints/background.ts` around 476) use a small `t()` over the same JSON, since there is no React there.
  - WXT `_locales/en/messages.json` holds the manifest `name` and `description` (`__MSG_extName__`), and the manifest sets `default_locale: "en"`, which Chrome requires once `__MSG_…__` fields are used.
- **Lint:**
  - Enable Biome `noJsxLiterals` for `apps/web/src/**` and `apps/extension/entrypoints/**`, excluding tests, `apps/web/src/components/ui/**` (shadcn primitives) and icon-only or punctuation literals (check the rule's options; if it can't express this, write a GritQL plugin in `scripts/lint/no-jsx-literal.grit`).
  - `noJsxLiterals` only sees JSX text, so add a GritQL rule (`scripts/lint/no-ui-string.grit`) for the other places people read strings: the `aria-label`, `placeholder`, `title` and `alt` attributes, and the first argument of `toast()`, `toast.success()`, `toast.error()` and `toast.loading()`. An allowlist covers data values and icon-only or punctuation strings.
  - Also flag `"en-US"` literals with a GritQL rule in the same paths.
- **Catalog check:** `scripts/i18n-catalog.test.ts` (run by the root `bun run test`). For every locale file under `messages/`, the keys equal `en.json`'s, the ICU parses, and each message has the same placeholder names and plural or select arguments as English. It also checks the `en-XA` generator against a fixture.

## Backend

- `settings/preferences.ts` (new):
  - `getPreferences` (query, the signed-in user) returns `{ locale }`, defaulting to `"en"`.
  - `setLocale` (mutation, `{ locale }`) checks against `SUPPORTED_LOCALES` and upserts.
  - `getPreferencesForUser` (internal, for the API).
- `publicApiMe.ts` `profileForOwner` adds `locale` to the `/v1/me` response. OpenAPI documents it as a plain string, so clients must tolerate new values.
- The public API gets no setter. The language is chosen in the app (parity reason: "a display preference set in Settings").

## Web

- **Settings, "Language" row** (`SettingsContent.tsx`, after Theme):
  - A shadcn `Select`. Each option shows the native name, with the English name muted beside it ("Deutsch · German"), so people can find their way back.
  - On change:
    1. optimistically switch the provider's locale and messages, loaded with a dynamic `import()` per locale so English users don't download the other catalogs;
    2. write the cookie and call `setLocale`;
    3. call `router.refresh()` so server components re-render;
    4. show the toast "Language changed" (in the new language) with Undo.
  - Under the row, a muted link "Help improve translations" opens a `mailto:` to the support address with the subject "Translation feedback (de)".
- **`lib/locale.ts`:** `useAccountLocaleSync()`, mounted in the authenticated layout, keeps the cookie in line with `getPreferences`.
- **Layout fixes found in the `en-XA` pass**, re-checked per language. Fix overflow with `min-w-0` and truncate or wrap, never by shortening the English text. In particular:
  - German compounds in the sidebar and bulk bar;
  - French spacing before `:` `?` `!` (follow the catalog, don't hardcode);
  - CJK line breaking (`word-break: keep-all` for `ko`, `line-break: strict` for `ja`);
  - system CJK fonts through `:lang(ja)`, `:lang(ko)` and `:lang(zh)` font-family fallbacks in the web's global CSS and the extension popup.
- **Dates and numbers** come from `useTeakFormatter`. Relative times ("2 days ago") use `Intl.RelativeTimeFormat` in the chosen locale.
- **Keyboard shortcut help:** key names stay as keys (⌘, Shift); descriptions are translated.

## Extension

- After sign-in and on each popup open, read `locale` from `/v1/me` (already called), store it in `chrome.storage.local`, and pass it to the popup's `IntlProvider`. Signed out, use the stored value, else English.
- **Background:**
  - On a locale change (`storage.onChanged`), rebuild the context menus with translated titles.
  - Content scripts ask the background for the locale and messages they need: the inline "Save to Teak" button labels and the saved and error states.
- **Omnibox suggestions:** the description templates are translated. The user's own card titles are not.
- **`public/_locales/<extension-locale>/messages.json`** (WXT) for `extName` and `extDescription`, in the 7 languages plus `en`. The directory names use the WebExtension locale codes, which differ from the app's: `pt-BR` → `pt_BR` and `zh-Hans` → `zh_CN` (the others are `es`, `de`, `fr`, `ja`, `ko`).
  - Chrome picks these by the browser's language. That is the store and manifest convention, so it is an accepted exception to "Settings only" for the manifest name.
- **Store listing text** (Chrome Web Store and AMO, by hand in their dashboards): translated description and summary, kept in `apps/extension/store-listing/<lang>.md` so the owner can paste them. Add a release-runbook step.

## API / MCP / SDK / CLI

- `/v1/me` returns `locale`. SDK: `me().locale`. The CLI's `teak whoami` prints "Language: Deutsch".
- No setter: a parity row records the reason.
- MCP tool descriptions and CLI output stay English, because developer surfaces are out of scope.

## AI translation workflow

- **`.agents/i18n.md` (new guide; add it to `.agents/README.md` and the root `AGENTS.md`).** It says:
  - every PR that adds or changes English keys also updates all seven catalogs;
  - how to translate: using the glossary, keeping ICU placeholders, plural categories per language (CLDR: `ja`, `ko` and `zh` use only `other`), and no machine-literal UI jargon;
  - how to check: run the catalog check and look at the screen.
- **`packages/i18n/glossary.md`** has one row per term with its translation in all 7 languages:
  - card, note, link, folder, smart folder, tag, archive, trash, favorite;
  - Revisit, Shuffle, Focus mode, Refresh details;
  - "More like this", highlight, reader;
  - the plan names.

  "Teak" and qualifier words never change.
- **Owner spot-check:** the proof bundle has a screenshot set per language. The owner reviews them and their notes become catalog fixes before merge.

## Commit plan (one PR, in reviewable commits)

1. Library setup, providers, `format.ts`, the pseudo-locale and lint rules (in warn mode).
2. `apps/web/src/components` folder by folder: cards, card-modal, search, sidebar, selection, forms, text-editor (the slash menu labels come from editorcn; wrap them with `t()` when building `defaultSlashCommandItems` in `RichMarkdownEditor.tsx:38`), settings, folders, tags, modals.
3. `apps/web/src/screens` and `apps/web/src/app` (page titles and metadata, empty states, errors).
4. The extension popup, the background menus and inline save buttons. Content-script button labels in `entrypoints/content/platforms/*` get their locale from a background message.
5. Formatters: replace every `"en-US"` and bare `toLocale*` in ui, web and the extension.
6. Switch the lint rules to error.
7. `userPreferences`, `/v1/me` `locale`, the Settings row, account sync, and the extension's locale handling.
8. The glossary, `.agents/i18n.md`, the seven catalogs, the `_locales` files and the store listing text.

## Docs

- `features.mdx`: a "Language" section listing the languages, Settings only, that the extension follows, and that search words stay in English. Plus a FAQ entry, which also says that some server-made text (link facts, bylines, import errors) stays English.
- The privacy policy needs no change: the language is a setting, not content.
- The changelog: "Teak in seven more languages".

## UI states

- **English:** every screen looks exactly as before.
- **The pseudo-locale pass is the layout test:**
  - buttons with a fixed width;
  - the sidebar row truncation;
  - the toast width (max 356 px);
  - the bulk action bar at 390 px;
  - the command palette rows;
  - the Settings rows;
  - the card modal's side panel labels;
  - the extension popup at its 360 px width.
- **Changing language:** the content swaps in place with no skeleton flash. While the new catalog loads, the select shows a small inline spinner (the one exception, since it is under 300 ms).
- **Failed save:** revert and show "Couldn't change the language. Try again." (in the old language).
- **Long strings:** check German on the bulk action bar at 390 px, the empty states, the card modal side panel labels, Settings rows and the extension popup at 360 px.
- **CJK:** check line breaks in toasts and in the empty states.
- **Plurals:** `0`, `1`, `2`, `5` and `21` cards in each language (Japanese, Korean and Chinese have a single form).

## Scenario seed packs

- Use `keyboard-mixed`, `folders-ugly`, `tags-2000`, `export-ugly` and `card-limit-199`, so that every toast, empty state and limit message appears in the pseudo-locale pass.
- Add `locale-switch`: an account whose preference is `de`, with the cookie set to `ja`, to test that the account wins on load.

## Break-it checklist

- **The pseudo-locale (`en-XA`):**
  - sidebar, grid, card modal for all 8 types, Settings, Tags, Trash, Archive, folders, search suggestions and pills;
  - command palette, keyboard help sheet, bulk bar, every toast;
  - card limit, import and export panels, the extension popup (signed in and out), the context menu and the omnibox.
- **Error and edge strings:** plural edge cases (0, 1, 2, 1,000 cards), dates near midnight and around time-zone changes, and a server error with an unknown code falling back to its message.
- **Rendering:** SSR versus client hydration (no hydration mismatch warnings with the cookie set), and the React Compiler build (`bun run --cwd apps/web build`).
- **Switch the language:**
  - on every screen;
  - mid-upload;
  - with the card modal open;
  - with the command palette open;
  - in two tabs at once (the second tab follows the account after a refresh);
  - while signed out, then sign in.
- **Extension:**
  - the popup before and after the account changes language;
  - the context menu after the change;
  - inline buttons on X and Instagram in `ja`.
- An unknown locale in the cookie, an unknown value from `/v1/me` (falls back to `en`), and a stale cookie after an account switch.
- Keyboard only through the Language select.
- Light and dark, 390, 768 and 1440 px, per language.

## Tests

- `scripts/i18n-catalog.test.ts` as above, covering all seven catalogs.
- `packages/i18n/src/__tests__/format.test.ts`: `formatDate` and the count presets for `en` and `de` (by constructing them), checking that the locale reaches `Intl`.
- `packages/i18n/src/__tests__/errors.test.ts`: known codes map to messages, and unknown codes fall back.
- Update the existing `renderToStaticMarkup` tests to render inside a test `IntlProvider` (a `renderWithIntl` helper in `apps/web/src/test-utils`), keeping their assertions on visible English text.
- `apps/web/src/__tests__/i18nRequest.test.ts`: the cookie is read and checked, and a missing or invalid cookie gives `en`.
- `packages/convex/userPreferences.test.ts` (convex-test, add to `vitest.config.ts`):
  - the default `en`;
  - checking against the supported list;
  - upsert;
  - ownership;
  - account deletion removes the row.
- `packages/convex/publicApiMe.test.ts`: `locale` in `/v1/me`. Plus SDK and CLI `whoami` tests.
- `apps/web/src/components/settings/__tests__/LanguageRow.test.tsx`: options in their native names, and the current value.
- `apps/extension/__tests__/locale.test.ts`: `/v1/me` sets the stored locale, and menus are rebuilt on change.
- e2e:
  - run the existing web specs unchanged (English);
  - `packages/tests/src/web/i18n-pseudo.e2e.ts` (new) sets the `en-XA` cookie on the dev stack and checks that page landmarks have pseudo text and no raw English for a sample of strings;
  - `packages/tests/src/web/language.e2e.ts` (new): change to Deutsch; the sidebar labels and a date are German; reload and it is still German; switch back to English.

## Proof before the PR

- **English:** screenshots of the main screens before and after (they should be identical).
- **Pseudo-locale:** screenshots in `en-XA` at 390 and 1440 px, light and dark, and a video of a full journey: add a card, search, open the modal, bulk select, change a setting, and use the extension popup.
- **Languages:** a video switching through all eight languages on the library, the card modal and Settings, then opening the extension popup in Japanese.
- **Screenshots per language** (the owner's spot-check set):
  - library, card modal (link and note), Settings, Tags, search suggestions;
  - bulk bar at 390 px, an empty state, the card-limit toast, and the extension popup;
  - in light and dark.
- **Captured:** `/v1/me` with `locale`, the catalog check and lint output, a deliberately added literal failing lint, and a deliberately removed key failing CI.

## Release gate

1. Run the repo checks, including `bun run --cwd apps/web build` (React Compiler) and `bun run --cwd apps/extension build` (Chrome and Firefox).
2. Run the pseudo-locale break-it pass, then the per-language pass, until both are clean.
3. Send the proof bundle to the owner, and apply the spot-check fixes.
4. Deploy Convex, then the web app. Release the extension (`apps/extension/release.md`), since its `_locales` and manifest changed, then paste the store listing text in each dashboard.
5. Smoke-test production in English, then switch the owner's account to German and back.

## Risks And Open Questions

- **Size of the PR.** Extracting about 500 strings and adding seven catalogs in one PR is large. The commits are split as in the commit plan, so reviewers can follow them one at a time; the catalogs land last, after the English extraction is settled.
- **next-intl and Next 16.4.** If next-intl has no release that supports Next 16.4, use `use-intl` alone. Pass messages from the root layout through a client provider and pick the locale server-side from the cookie.
- **Decided:** the catalog and its helpers live in a new `packages/i18n` workspace that the web app and the extension both import. Its tests run from its own `test` script, and `.agents/testing.md` gains a row for it.
- **Open decision:** whether server-made strings stored on cards (link facts, bylines, price labels) get translated in v3 (default: no, they stay English; noted for a later phase).
- **The editorcn slash menu and its toolbar tooltips** may hardcode labels inside the package. If they can't be overridden, wrap or fork the item list. That is fine because `RichMarkdownEditor.tsx` already filters it.
- **Open decision:** Simplified Chinese only (`zh-Hans`), or also Traditional (`zh-Hant`) for Taiwan and Hong Kong (default: Simplified only; Traditional is a cheap later addition).
- **Open decision:** formal or informal register for Spanish, German and French (default: formal, as above).
- **Open decision:** whether the manifest name and description follow the browser's language (default: yes, it's how stores work), while the UI follows Settings.
- **Quality without native reviewers.** The owner's spot-check covers the main screens only. The feedback link and the glossary limit drift. Revisit native review if a language gets real traffic, which PostHog `locale` will show.
- **Catalog drift.** Every later PR must update seven files. The CI check enforces it, and `.agents/i18n.md` tells agents how.
- **Server-made English** (link facts, bylines, import errors) will appear inside translated screens. That is accepted for v3 and noted in the docs FAQ.
