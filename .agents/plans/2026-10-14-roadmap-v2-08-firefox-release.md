## Goal

Publish the Teak extension for Firefox on addons.mozilla.org (AMO), with every flow working as it does in Chrome, and add Firefox to the release runbook and the docs. Phase 8 of the [roadmap v2](2026-10-14-roadmap-v2-00-roadmap.md).

## Depends on

- Phase 6 (tags and note after saving, source for Save Text; built) and phase 7 (address-bar search; built). Firefox launches with the full feature set.

## Success Criteria

- `bun run --cwd apps/extension zip:firefox` builds a Firefox package with no `web-ext lint` errors.
- In Firefox 140 (the manifest's `strict_min_version`) and the latest release, these all work:
  - sign-in and sign-out
  - auto-save on open, and the tags and note after saving
  - the three context menus (page, asset, text with its source)
  - file upload
  - pending-save retry
  - the inline save buttons on Instagram, Pinterest and X
  - address-bar search
- The listing is live on AMO. `Extension Release` attaches `teak-extension-<version>-firefox.zip` to the GitHub Release and submits it to AMO at the same lockstep version as Chrome.
- The docs list Firefox: `extension.mdx`, the apps grid and the ship-month changelog.

## Context And Current Facts

- `apps/extension/package.json` already has `build:firefox`, `dev:firefox` and `zip:firefox` (`wxt … -b firefox`). `wxt.config.ts` sets `browser_specific_settings.gecko = { id: "teak@teakvault.com", strict_min_version: "140.0" }`. The manifest also carries a Chrome-only `key`, which Firefox ignores and `web-ext lint` may warn about.
- Sign-in is already Firefox-aware. `lib/oauthAuth.ts:18` sets `IS_FIREFOX = import.meta.env.BROWSER === "firefox"`, and uses the `firefox` client from `/.well-known/teak-oauth-clients.json` (`publicApiMeta.ts:191`, `WORKOS_CONNECT_FIREFOX_CLIENT_ID`, listed in `scripts/env-contract-entries-backend.ts:82`). It stores credentials in IndexedDB on Firefox (`firefoxCredentials`), and signs in with `chrome.identity.launchWebAuthFlow` and `getRedirectURL("oauth/callback")`.
- `workosConsents.ts:132` labels the client "Firefox extension". `client/authDiscovery.ts` lists `OAUTH_SURFACES = ["cli", "raycast", "chrome", "firefox"]`.
- The content script (`entrypoints/content.ts`) matches `<all_urls>`, and the platform buttons live in `entrypoints/content/platforms/` (instagram, pinterest, x, hackernews, heydesigner, sidebar).
- `.github/workflows/extension-release.yml` builds only `bun run zip`, looks for `*-chrome.zip`, uploads with `chrome-webstore-upload-cli@3`, and attaches `teak-extension-<version>-chrome.zip`. `apps/extension/release.md` covers Chrome only and lists only Chrome secrets.
- Docs that need updating:
  - `content/docs/(apps)/extension.mdx:10` says "There is no Firefox version yet."
  - The Chrome card is in `apps/docs/components/AppsGrid.astro` (around line 111), with `public/badges/chrome-web-store-badge.svg` and `public/platform-icons/chrome.svg`. There is no Firefox badge or icon.
  - `pages/apps.astro` only holds the page metadata.
- AMO requires the source code for bundled or minified add-ons. `wxt zip -b firefox` also writes a `*-sources.zip`. In this monorepo, that archive must include the workspace packages the bundle imports (`packages/convex` generated API, `packages/ui`), configured with WXT's `zip.includeSources`.

## Constraints And Non-goals

- Fix the gaps found in Firefox in shared code, behind `import.meta.env.BROWSER` checks only where the APIs really differ.
- No new permissions. Firefox MV3 shows `host_permissions` at install, and the plan must confirm `<all_urls>` is granted on 140+ rather than left optional. If it isn't, add a "Grant access" step to the popup.
- The first AMO listing is uploaded by hand, like the first Chrome upload. After that it's automated with `web-ext sign --channel=listed`, using `AMO_JWT_ISSUER` and `AMO_JWT_SECRET` (new GitHub secrets, never printed).
- Safari stays part of the Apple app.

## Backend

- None. The Firefox OAuth client is already configured. Confirm `WORKOS_CONNECT_FIREFOX_CLIENT_ID` is set on production (`bun run audit:env` or the Convex dashboard), and that the WorkOS client allows the Firefox redirect URI (`https://<uuid>.extensions.allizom.org/oauth/callback`, from `identity.getRedirectURL`).

## Web

- None.

## Extension

- `wxt.config.ts`:
  - `zip.includeSources` / `excludeSources` for the monorepo sources.
  - Leave the `key` out of the Firefox manifest (`manifest: ({ browser }) => …`).
  - `browser_specific_settings.gecko.data_collection_permissions`, if AMO requires it for PostHog error reporting (check the current AMO policy).
- Fixes found during the pass, each with a regression test. Likely places:
  - `chrome.action.openPopup()` after a context-menu save while signed out (Firefox needs a user gesture)
  - `scripting.executeScript` in the PDF viewer
  - omnibox description escaping (plain text, phase 7)
- `apps/extension/release.md`: an "AMO (Firefox)" section with the first manual listing, the sources zip, the reviewer notes (how to build, how to sign in with a test account), the automated path, the secrets and the recovery steps.
- `.github/workflows/extension-release.yml`:
  - build `zip:firefox`
  - attach `teak-extension-<version>-firefox.zip`
  - find the `*-sources.zip` WXT wrote and copy it to `teak-extension-<version>-sources.zip`, the way the Chrome step renames its zip
  - sign and submit with `web-ext sign --channel=listed --upload-source-code teak-extension-<version>-sources.zip`, so every listed version ships its sources to AMO, skipping when the version was already submitted, like the Chrome step

## API / MCP / SDK / CLI

- None.

## Docs

- `(apps)/extension.mdx`: an "Install for Firefox" section with the AMO link. Remove "There is no Firefox version yet", and say which features apply to both browsers.
- `components/AppsGrid.astro`: a Firefox card, plus `public/badges/firefox-addons-badge.svg` and `public/platform-icons/firefox.svg`, using Mozilla's official badge artwork.
- `pages/apps.astro`: add "firefox" to the meta description and keywords.
- Ship-month changelog: "Teak for Firefox".

## UI states

- Every popup state from Chrome, checked in Firefox:
  - signed out
  - saving, saved (with details), already saved
  - can't save this page (`about:`, `moz-extension:`)
  - error
  - upgrade (card limit)
  - pending saves
- **Very long names:** long page titles and tags in the Firefox popup, whose default font and scrollbar differ.
- **Rate-limited:** the 429 copy from phases 6 and 7.
- **UI bar:** the popup width and dark mode in Firefox, where `prefers-color-scheme` follows the Firefox theme.

## Scenario seed packs

- All of phase 6 and 7's packs (`tags-2000`, `omnibox-titles`, the 199-card account), plus the context-menu fixture pages.
- Live Instagram, Pinterest and X posts: image, carousel and video.

## Break-it checklist

- **Firefox 140 and latest, on macOS and Windows:**
  - sign in, restart Firefox, still signed in
  - private window (IndexedDB credentials are not saved there; the popup must say so)
  - container tabs
  - context menu on an image, a link and a selection
  - Save Text on the built-in PDF viewer
  - the inline buttons after infinite scroll
  - file upload of 100 MB
  - offline save, then the retry
  - address-bar search signed in and signed out
  - tags and note, closing mid-typing
  - extension update with pending saves
- **Backend:** a consent screen with the Firefox client, and disconnecting the Firefox app from Settings → Connected apps (`workosConsents`).

## Tests

- `apps/extension/__tests__/build/wxtConfig.test.ts`: the Firefox manifest has the gecko id, no `key`, `omnibox.keyword`, and Firefox-compatible background scripts.
- `apps/extension/__tests__/lib/oauthAuth.test.ts`: existing Firefox credential tests stay green. Add one for every bug fixed.
- A CI step `npx web-ext@8 lint --source-dir apps/extension/.output/firefox-mv3`, failing on errors.
- `packages/tests/src/docs/extra-prod-surfaces.e2e.ts`: after release, a probe of the AMO listing URL (200).

## Proof before the PR

- **Video (Firefox latest):** install the unpacked build, sign in, auto-save with tags, Save Text with its source, an inline Instagram save, and address-bar search.
- **Video, worst case:** Firefox 140, a private window, offline retry.
- **Screenshots:** each popup state in Firefox, light and dark. The apps page and `extension.mdx` at 390px and 1440px.
- Captured output: `web-ext lint`, the contents of the sources zip, and a dry run of the release workflow showing the `web-ext sign` command with `--upload-source-code` pointing at the versioned sources zip.

## Release gate

1. Run the narrow tests, then the repo checks, `bun run --cwd apps/extension test`, `typecheck`, `build:firefox` and `web-ext lint`.
2. Run the full break-it pass in Firefox 140 and the latest release. Fix and add regression tests.
3. Send the proof bundle.
4. Open the PR; CI must be green. Merge. Deploy the docs and the web app; there is no backend change. Do the first AMO listing by hand from the release zip and sources zip, following the new runbook section. Later releases go through the workflow. Smoke-test the approved AMO build in a clean Firefox profile.

## Risks And Open Questions

- **AMO review.** Review can take days, and reviewers rebuild from the sources. If the monorepo build isn't reproducible from the sources zip, the listing is rejected. Test the rebuild in a clean checkout first.
- **Version lockstep.** If AMO rejects a version, Chrome and Firefox drift until the next patch. The runbook should say that's acceptable.
- **Approved-plan wording.** The approved plan said to add Firefox to `apps/docs/pages/apps.astro`. The store cards actually live in `apps/docs/components/AppsGrid.astro`.
