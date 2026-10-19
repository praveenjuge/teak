## Goal

Let people use Teak's web app and browser extension in Spanish, Portuguese (Brazil), German, French, Japanese, Korean and Chinese. The language is chosen in Settings → Language, saved to the account, and followed by the extension. Catalogs are translated by AI and spot-checked by the owner, and CI keeps them complete. Phase 17 of the [roadmap v3](2026-10-19-roadmap-v3-00-roadmap.md).

## Depends on

- [Phase 16](2026-10-19-roadmap-v3-16-i18n-foundation.md): the library, the English catalog, formatters, lint rules and the catalog check.

## Success Criteria

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
- **Everywhere it applies:** every string extracted in phase 16, and dates, numbers and plurals, appear in the chosen language on every web screen and in the extension: popup, context menus, inline save buttons and omnibox suggestions. The extension reads the account's language after sign-in.
- **The catalogs:** `es.json`, `pt-BR.json`, `de.json`, `fr.json`, `ja.json`, `ko.json` and `zh-Hans.json` exist, and the phase 16 catalog check passes: same keys, same placeholders, valid ICU.
- **Store listings:** the extension's manifest name and description and its Chrome Web Store listing text exist in all seven languages.
- **What stays English:**
  - search syntax and qualifiers (`is:fav`, `type:image`, date words);
  - server-made text stored on cards (link facts, bylines);
  - the docs site and emails.

  Suggestion labels and pills are translated.
- **AI process:** a guide tells agents to translate every new English key into all seven catalogs in the same PR, using the glossary. CI fails when a catalog is missing a key.

## Context And Current Facts

- After phase 16:
  - `packages/ui/src/i18n/locales.ts` has `SUPPORTED_LOCALES = ["en"]` and `LOCALE_COOKIE = "teak-locale"`.
  - `apps/web/src/i18n/request.ts` reads the cookie.
  - The extension popup is wrapped in `IntlProvider` (check these paths when starting; phase 16 may have moved them).
- **No preference storage today.** The `users` table (`packages/convex/schema.ts:529-541`) holds only identity fields. Theme is per device, through `ThemeToggle` (`packages/ui/src/components/settings/SettingsContent.tsx:192-194`).
- **`/v1/me`** (`packages/convex/publicApiMe.ts`, `profileForOwner` 14–27) returns email, plan and optionally `cardCount`.
  - The extension calls it in `getOAuthState` (`apps/extension/lib/oauthAuth.ts:458`).
- The extension's context menus are created in `entrypoints/background.ts` (around 476), and its inline buttons in `entrypoints/content/platforms/*`.
- The extension is released through `apps/extension/release.md`. The first Chrome Web Store and AMO listings were made by hand, and listing text lives in each store's dashboard.

## Constraints And Non-goals

- **Languages:** `es`, `pt-BR`, `de`, `fr`, `ja`, `ko` and `zh-Hans` (Simplified). No Traditional Chinese (see Risks) and no right-to-left languages.
- **Preference storage:** a new table `userPreferences { userId, locale, updatedAt }` with index `by_userId`. Not a field on `users`, which stays identity-only.
  - It is covered by account deletion (`accountDeletionData.ts` `ancillaryPage`) and seeded in the "complete stages" test. Its batch's `length > 0` joins `ancillaryPage`'s continuation return (`accountDeletionData.ts`, the `return (cardLinks.length > 0 || …)` near line 202), so more than one page of rows is deleted;.
- **The cookie** mirrors the account preference for server rendering. The account is the source of truth. On load, a client effect compares the two and, if they differ, writes the cookie and calls `router.refresh()`. Signing out clears the cookie.
- **No locale in URLs** and no automatic detection.
- **Translation quality bar:**
  - sentence case where the language has case;
  - "Teak" and qualifiers never translated;
  - the glossary terms used consistently;
  - formal register: `usted` (es), `Sie` (de), `vous` (fr), `você` (pt-BR); polite です/ます (ja); 합니다 / 해요 as the glossary sets it (ko).
- **Analytics:** add `locale_changed { from, to }` first. Add `locale` as a person property (`.agents/analytics.md`).

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
- **Layout fixes found in the phase 16 `en-XA` pass**, re-checked per language. In particular:
  - German compounds in the sidebar and bulk bar;
  - French spacing before `:` `?` `!` (follow the catalog, don't hardcode);
  - CJK line breaking (`word-break: keep-all` for `ko`, `line-break: strict` for `ja`);
  - system CJK fonts through `:lang()`.
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
- **`packages/ui/src/i18n/glossary.md`** has one row per term with its translation in all 7 languages:
  - card, note, link, folder, smart folder, tag, archive, trash, favorite;
  - Revisit, Shuffle, Focus mode, Refresh details;
  - "More like this", highlight, reader;
  - the plan names.

  "Teak" and qualifier words never change.
- **Owner spot-check:** the proof bundle has a screenshot set per language. The owner reviews them and their notes become catalog fixes before merge.

## Docs

- `features.mdx`: a "Language" section listing the languages, Settings only, that the extension follows, and that search words stay in English. Plus a FAQ entry.
- The privacy policy needs no change: the language is a setting, not content.
- The changelog: "Teak in seven more languages".

## UI states

- **Changing language:** the content swaps in place with no skeleton flash. While the new catalog loads, the select shows a small inline spinner (the one exception, since it is under 300 ms).
- **Failed save:** revert and show "Couldn't change the language. Try again." (in the old language).
- **Long strings:** check German on the bulk action bar at 390 px, the empty states, the card modal side panel labels, Settings rows and the extension popup at 360 px.
- **CJK:** check line breaks in toasts and in the empty states.
- **Plurals:** `0`, `1`, `2`, `5` and `21` cards in each language (Japanese, Korean and Chinese have a single form).

## Scenario seed packs

- Reuse the phase 16 packs.
- Add `locale-switch`: an account whose preference is `de`, with the cookie set to `ja`, to test that the account wins on load.

## Break-it checklist

- Switch the language:
  - on every screen;
  - mid-upload;
  - with the card modal open;
  - with the command palette open;
  - in two tabs at once (the second tab follows the account after a refresh);
  - while signed out, then sign in.
- Extension:
  - the popup before and after the account changes language;
  - the context menu after the change;
  - inline buttons on X and Instagram in `ja`.
- An unknown locale in the cookie, an unknown value from `/v1/me` (falls back to `en`), and a stale cookie after an account switch.
- Keyboard only through the Language select.
- Light and dark, 390, 768 and 1440 px, per language.

## Tests

- `scripts/i18n-catalog.test.ts` now covers all seven catalogs.
- `packages/convex/userPreferences.test.ts` (convex-test, add to `vitest.config.ts`):
  - the default `en`;
  - checking against the supported list;
  - upsert;
  - ownership;
  - account deletion removes the row.
- `packages/convex/publicApiMe.test.ts`: `locale` in `/v1/me`. Plus SDK and CLI `whoami` tests.
- `packages/ui/src/components/settings/__tests__/LanguageRow.test.tsx`: options in their native names, and the current value.
- `apps/extension/__tests__/locale.test.ts`: `/v1/me` sets the stored locale, and menus are rebuilt on change.
- e2e: `packages/tests/src/web/language.e2e.ts` (new):
  - change to Deutsch; the sidebar labels and a date are German;
  - reload and it is still German;
  - switch back to English.

## Proof before the PR

- **Video:** switch through all eight languages on the library, the card modal and Settings, then open the extension popup in Japanese.
- **Screenshots per language:**
  - library, card modal (link and note), Settings, Tags, search suggestions;
  - bulk bar at 390 px, an empty state, the card-limit toast, and the extension popup;
  - in light and dark.

  This is the owner's spot-check set.
- **Captured:** `/v1/me` with `locale`, the catalog check output, and a deliberately removed key failing CI.

## Release gate

1. Run the repo checks and builds.
2. Run the per-language break-it pass.
3. Send the proof bundle to the owner, and apply the spot-check fixes.
4. Deploy Convex, then the web app. Release the extension (`apps/extension/release.md`), then paste the store listing text in each dashboard.
5. Smoke-test production by switching the owner's account to German and back.

## Risks And Open Questions

- **Open decision:** Simplified Chinese only (`zh-Hans`), or also Traditional (`zh-Hant`) for Taiwan and Hong Kong (default: Simplified only; Traditional is a cheap later addition).
- **Open decision:** formal or informal register for Spanish, German and French (default: formal, as above).
- **Open decision:** whether the manifest name and description follow the browser's language (default: yes, it's how stores work), while the UI follows Settings.
- **Quality without native reviewers.** The owner's spot-check covers the main screens only. The feedback link and the glossary limit drift. Revisit native review if a language gets real traffic, which PostHog `locale` will show.
- **Catalog drift.** Every later PR must update seven files. The CI check enforces it, and `.agents/i18n.md` tells agents how.
- **Server-made English** (link facts, bylines, import errors) will appear inside translated screens. That is accepted for v3 and noted in the docs FAQ.
