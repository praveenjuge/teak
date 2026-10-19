## Goal

Make the web app and the browser extension translatable without changing what anyone sees. This phase:
- picks an i18n library;
- moves every user-facing string in `apps/web`, `packages/ui` and `apps/extension` into an English message catalog;
- routes dates and numbers through locale-aware formatters;
- carries the locale without putting it in the URL;
- adds checks that stop new hardcoded strings.

It ships English only, plus a development pseudo-locale. Phase 17 adds the seven languages and the Settings → Language picker. Phase 16 of the [roadmap v3](2026-10-19-roadmap-v3-00-roadmap.md).

## Depends on

- Nothing in v3. It runs after phases 1–15 in the roadmap order so that their new strings are extracted once. Strings added later must go through the catalog from the start.

## Success Criteria

- **Library and catalog:** one library serves Next.js (server and client components), `packages/ui`, and the WXT extension's React popup. The shared English catalog lives in one place.
- **Nothing visible changes in English:** screenshot diffs of the main screens show no change.
- **The pseudo-locale** `en-XA` works only in development, set by a cookie or the `?__locale=en-XA` parameter (a dev-only exception to "no locale in URLs"; production ignores the parameter). In the extension, a dev build reads an `en-XA` override from `chrome.storage.local` (set from the popup's dev menu), which the popup, the background's context menus and the omnibox all follow. It wraps every string as `[Ŝéţţîñĝš ~~~~]` and lengthens it by about 40%. Every screen in the break-it list renders with no un-wrapped English, no clipped buttons and no overflow at 390 px.
- **Dates and numbers** go through formatters keyed on the active locale. No `"en-US"` literal is left in `packages/ui` or `apps/web`. While the UI language is English, each formatter keeps the locale it uses today: the browser's locale where the code calls `toLocaleDateString()` with no locale, and `en-US` where it is hardcoded. So English output doesn't change for anyone; another UI language uses that language. A test renders a date with the UI in English and the browser in `de-DE` and checks it matches today's output.
- **`<html lang>`** follows the active locale in every HTML root: `layout.tsx`, `global-error.tsx` (it replaces the root layout, so it reads the cookie and loads its few messages itself; `<html lang="en">` at line 41 today), and the extension popup, whose static `index.html` says `lang="en"`, so the popup sets `document.documentElement.lang` once the stored locale is loaded.
- **CI fails when:**
  - a non-English catalog has missing or extra keys, or ICU placeholders that don't match English (wired up now, used from phase 17);
  - a new JSX string literal is added in the covered paths.
- **Nothing in the Convex API, public API, search syntax or stored data changes.**

## Context And Current Facts

- **Versions:**
  - `apps/web` uses `next` 16.4.0 with `reactCompiler: true` (`apps/web/next.config.ts:56`).
  - React is 19.3.0 (root `package.json:49-50`).
  - The extension uses `wxt` ^0.21.3 and `@wxt-dev/module-react` (`apps/extension/package.json:32-35`), and imports `@teak/ui` components (for example `entrypoints/popup/SaveDetails.tsx:2`).
- **No i18n library or catalog anywhere** in web, ui, extension or docs.
  - `apps/web/src/app/layout.tsx:48` hardcodes `lang="en"`.
  - The WXT extension has no `_locales`. The separate Safari extension in `apps/apple/SafariExtension` has `_locales/en/messages.json` and is out of scope.
- **Hardcoded strings:** about 340 JSX text lines and 57 toast calls across about 149 `.tsx` files in `packages/ui` and `apps/web`, plus aria-labels, titles and placeholders. The extension popup's `App.tsx` alone is 566 lines.
- **Hardcoded `"en-US"`:**
  - `packages/ui/src/components/card-modal/cardHeading.ts:63`
  - `packages/ui/src/components/card-modal/cardDetails.ts:6,79`
  - `packages/ui/src/lib/exif.ts:64`
  - `packages/ui/src/lib/linkByline.ts:62`
  - Convex-side: `shared/search/qualifiers.ts:209` (price labels), `shared/utils/timeSearch.ts:79,86`, `workflows/steps/categorization/providers/common.ts:88,123` (facts stored on cards), `import/csv.ts:52`, `linkMetadata/x.ts:138` and `linkMetadata/socialPostHelpers.ts:123` (bylines stored on cards).
  - About 18 files in ui, web and the extension call `toLocaleString`, `toLocaleDateString` or `Intl.*` without a locale, for example `TagsScreen.tsx` `cardCountLabel`.
- **Server error messages** reach toasts as English text: `FOLDER_ERROR_MESSAGES` (`shared/folders.ts`), `TAG_ERROR_MESSAGES` (`shared/tags.ts`), `THUMBNAIL_ERROR_MESSAGES`, and `ConvexError({ code, message })`. Most carry a `code`.
- **Linting:** Biome 2.5.15 through ultracite 7.12.0 (`biome.json`). It has a `noJsxLiterals` rule (`configuration_schema.json`), and the repo already uses GritQL plugins (`scripts/lint/*.grit`).
- **Settings** (`packages/ui/src/components/settings/SettingsContent.tsx:192`) has a Theme row. Phase 17 puts Language next to it.

## Library choice

| Option | Fit |
|---|---|
| **next-intl (web) + use-intl (ui, extension)**, the default | One ICU message format and one `useTranslations` / `useFormatter` API everywhere. next-intl supports App Router without i18n routing, with the locale read from a cookie in `i18n/request.ts`. use-intl's `IntlProvider` is plain React, so it works in the WXT popup. Message keys are plain JSON, so AI translation and key checks are simple. No compiler plugin, so it doesn't interact with the React Compiler |
| Lingui | Good extraction from macros, but needs its SWC plugin for Next 16.4 and a Babel or Vite macro setup for the extension and `packages/ui`. That is three build integrations, plus a check that the SWC plugin works alongside the React Compiler. More moving parts |
| react-i18next | Works everywhere, but has a heavier runtime and weaker ICU (a plugin). Its server-component story in Next is DIY |
| Native `Intl` plus a small in-house `t()` | Smallest, but rebuilds plurals, rich text and type-safe keys by hand |

Default: **next-intl / use-intl**. Spend half a day confirming that next-intl's latest release supports Next 16.4 and that `useTranslations` works in a `"use client"` component compiled with the React Compiler, before extracting anything.

## Constraints And Non-goals

- **Scope:** `apps/web`, `packages/ui` and `apps/extension` only. Not the Apple, Android, Raycast or Safari extension apps, the docs site, or email.
- **No locale in URLs.** The locale comes from a `teak-locale` cookie, defaulting to `en`. Phase 17 sets the cookie from the account preference.
- **Search syntax stays English** (`is:fav`, `type:image`, date words in `timeSearch.ts`). Suggestion and pill labels shown to people are translated.
- **Server-made strings stay English in v3:** link facts, bylines, price labels in `qualifiers.ts`, import errors, and Convex `message`s. The web maps known error `code`s to catalog messages and falls back to the server's English text for unknown codes. Those server fallbacks are exempt from the `en-XA` "no unwrapped English" check, which covers only catalog strings.
- **Keys** are namespaced by component (`cardModal.menu.replaceImage`), with ICU plurals (`{count, plural, one {# card} other {# cards}}`), and no string concatenation.
- **No feature flags.** The pseudo-locale is dev-only and stripped from production by `process.env.NODE_ENV`.

## Packages and files

- `packages/ui/src/i18n/` (new):
  - `locales.ts`: `SUPPORTED_LOCALES = ["en"]` (phase 17 extends it), `DEFAULT_LOCALE`, `isSupportedLocale`, and `LOCALE_COOKIE = "teak-locale"`.
  - `messages/en.json`: the single source catalog for ui, web and extension.
  - `packages/ui/package.json` gains `"./i18n": "./src/i18n/index.ts"` and `"./i18n/messages/*": "./src/i18n/messages/*"` in its `exports` map, which is explicit today, so the web and extension can import them.
  - `pseudo.ts`: builds `en-XA` from `en.json` at runtime in development.
  - `format.ts`: `useTeakFormatter()` wrapping use-intl's `useFormatter`, with presets `date.short` ("Oct 19, 2026"), `date.long`, `dateTime`, `number`, `count` and `bytes`. Also a non-hook `formatDate(locale, …)` for helpers called outside React (`cardHeading.ts`, `cardDetails.ts`, `exif.ts`, `linkByline.ts`).
  - `errors.ts`: `messageForError(t, code, fallback)` for `CARD_LIMIT_REACHED`, `RATE_LIMITED`, folder and tag codes, thumbnail codes, and `TAG_OPERATION_RUNNING`.
- `apps/web`:
  - `src/i18n/request.ts` (next-intl `getRequestConfig`): reads the `teak-locale` cookie, checks it, and loads messages.
  - `layout.tsx` wraps the app in `NextIntlClientProvider` and sets `<html lang={locale}>`.
  - `next.config.ts` adds the next-intl plugin.
- `apps/extension`:
  - The popup root wraps in `IntlProvider` with `en.json`. Phase 17 picks the locale.
  - Background context-menu titles (`entrypoints/background.ts` around 476) use a small `t()` over the same JSON, since there is no React there.
  - WXT `_locales/en/messages.json` holds the manifest `name` and `description` (`__MSG_extName__`), and the manifest sets `default_locale: "en"`, which Chrome requires once `__MSG_…__` fields are used, so store listings can be localized in phase 17.
- **Lint:**
  - Enable Biome `noJsxLiterals` for `packages/ui/src/**`, `apps/web/src/**` and `apps/extension/entrypoints/**`, excluding tests, `ui/components/ui/**` (shadcn primitives) and icon-only or punctuation literals (check the rule's options; if it can't express this, write a GritQL plugin in `scripts/lint/no-jsx-literal.grit`).
  - `noJsxLiterals` only sees JSX text, so add a GritQL rule (`scripts/lint/no-ui-string.grit`) for the other places people read strings: the `aria-label`, `placeholder`, `title` and `alt` attributes, and the first argument of `toast()`, `toast.success()`, `toast.error()` and `toast.loading()`. An allowlist covers data values and icon-only or punctuation strings.
  - Also flag `"en-US"` literals with a GritQL rule in the same paths.
- **Catalog check:** `scripts/i18n-catalog.test.ts` (run by the root `bun run test`). For every locale file under `messages/`, the keys equal `en.json`'s, the ICU parses, and each message has the same placeholder names and plural or select arguments as English. With only `en.json` today it checks ICU validity, and checks the `en-XA` generator against a fixture.

## Extraction plan (inside this one PR, done in reviewable commits)

1. Library setup, providers, `format.ts`, the pseudo-locale and lint rules (in warn mode).
2. `packages/ui/src/components` folder by folder: cards, card-modal, search, sidebar, selection, forms, text-editor (the slash menu labels come from editorcn; wrap them with `t()` when building `defaultSlashCommandItems` in `RichMarkdownEditor.tsx:38`), settings, folders, tags, modals.
3. `packages/ui/src/screens` and `apps/web/src/app` (page titles and metadata, empty states, errors).
4. The extension popup, the background menus and inline save buttons. Content-script button labels in `entrypoints/content/platforms/*` get their locale from a background message.
5. Formatters: replace every `"en-US"` and bare `toLocale*` in ui, web and the extension.
6. Switch the lint rules to error.

## UI states

- Every screen in English looks exactly as before. The pseudo-locale pass is the layout test:
  - buttons with a fixed width;
  - the sidebar row truncation;
  - the toast width (max 356 px);
  - the bulk action bar at 390 px;
  - the command palette rows;
  - the Settings rows;
  - the card modal's side panel labels;
  - the extension popup at its 360 px width.
- Fix overflow with `min-w-0` and truncate or wrap, never by shortening the English text.
- **CJK readiness:** add `:lang(ja)`, `:lang(ko)` and `:lang(zh)` font-family fallbacks (system CJK fonts) in the web's global CSS and the extension popup, and `word-break: keep-all` for `ko`. These are verified in phase 17.

## Scenario seed packs

- None new. Use `keyboard-mixed`, `folders-ugly`, `tags-2000`, `export-ugly` and `card-limit-199`, so that every toast, empty state and limit message appears in the pseudo-locale pass.

## Break-it checklist

- **The pseudo-locale (`en-XA`):**
  - sidebar, grid, card modal for all 8 types, Settings, Tags, Trash, Archive, folders, search suggestions and pills;
  - command palette, keyboard help sheet, bulk bar, every toast;
  - card limit, import and export panels, the extension popup (signed in and out), the context menu and the omnibox.
- **Error and edge strings:** plural edge cases (0, 1, 2, 1,000 cards), dates near midnight and around time-zone changes, and a server error with an unknown code falling back to its message.
- **Rendering:** SSR versus client hydration (no hydration mismatch warnings with the cookie set), and the React Compiler build (`bun run --cwd apps/web build`).

## Tests

- `scripts/i18n-catalog.test.ts` as above.
- `packages/ui/src/i18n/__tests__/format.test.ts`: `formatDate` and the count presets for `en` and `de` (by constructing them), checking that the locale reaches `Intl`.
- `packages/ui/src/i18n/__tests__/errors.test.ts`: known codes map to messages, and unknown codes fall back.
- Update the existing `renderToStaticMarkup` tests to render inside a test `IntlProvider` (a `renderWithIntl` helper in `packages/ui/src/test-utils`), keeping their assertions on visible English text.
- `apps/web/src/__tests__/i18nRequest.test.ts`: the cookie is read and checked, and a missing or invalid cookie gives `en`.
- e2e: run the existing web specs unchanged (English). Add `packages/tests/src/web/i18n-pseudo.e2e.ts`, which sets the `en-XA` cookie on the dev stack and checks that page landmarks have pseudo text and no raw English for a sample of strings.

## Proof before the PR

- Screenshots of the main screens in `en` before and after (they should be identical), and in `en-XA` at 390 and 1440 px, light and dark.
- A video of a full journey in `en-XA`: add a card, search, open the modal, bulk select, change a setting, and use the extension popup.
- The output of the catalog check and lint, showing a deliberately added literal failing.

## Release gate

1. Run the repo checks, including `bun run --cwd apps/web build` (React Compiler) and `bun run --cwd apps/extension build` (Chrome and Firefox).
2. The pseudo-locale break-it pass is clean.
3. Send the proof bundle to the owner.
4. Merge and deploy the web app. Release the extension as a patch (`apps/extension/release.md`), since its `_locales` and manifest changed.
5. Smoke-test production in English.

## Risks And Open Questions

- **Size of the PR.** Extracting about 500 strings in one PR is large. The phase stays one PR (one feature), but the commits are split as in the extraction plan, and reviewers can follow them commit by commit.
- **next-intl and Next 16.4.** If next-intl has no release that supports Next 16.4, use `use-intl` alone. Pass messages from the root layout through a client provider and pick the locale server-side from the cookie.
- **Open decision:** catalog location `packages/ui/src/i18n/messages` versus a new `packages/i18n` workspace (default: inside `packages/ui`, since the web and extension already depend on it).
- **Open decision:** whether server-made strings stored on cards (link facts, bylines, price labels) get translated in v3 (default: no, they stay English; noted for a later phase).
- **The editorcn slash menu and its toolbar tooltips** may hardcode labels inside the package. If they can't be overridden, wrap or fork the item list. That is fine because `RichMarkdownEditor.tsx` already filters it.
