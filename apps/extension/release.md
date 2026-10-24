# Browser extension release

The extension ships through `.github/workflows/extension-release.yml`: Chrome to the Chrome Web Store, Firefox to addons.mozilla.org (AMO), and both to the matching GitHub Release.

## Canonical release

1. Complete the shared preparation in `../../.agents/releases.md` and merge the scoped version change to `main`.
2. `Version Tag` verifies the patch and lockstep invariants, creates `v<version>`, and dispatches every product release for that tag.
3. `Extension Release` runs two jobs from the tag:
   - Chrome: verifies the extension version, builds the production Chrome zip, submits it to the Chrome Web Store, and attaches `teak-extension-<version>-chrome.zip`.
   - Firefox: verifies the version, builds the production Firefox zip and its sources zip, runs `web-ext lint`, submits the version to AMO as listed with its sources, and attaches `teak-extension-<version>-firefox.zip` and `teak-extension-<version>-sources.zip`.
4. Verify the workflow and the GitHub assets, then check each store's submission state. Store review may continue after the workflow succeeds.

The release is complete when the exact zips are attached to the GitHub Release and both stores have accepted the submission for review.

## Store listing text

The listing's summary and description live in `store-listing/<locale>.md`: English and the seven languages the extension is translated into, named like the `_locales` folders (`pt_BR`, `zh_CN`). The stores don't read them from the upload, so in a release that changes any of them, paste each changed language into the Chrome Web Store dashboard (**Store listing**, per language) and the AMO Developer Hub (**Edit Product Page**, per locale). The manifest's own name and description come from `public/_locales/<locale>/messages.json` and ship with the build. Chrome only takes the description per language; the summary comes from the package.

Keep the description free of lists of site or brand names. The Chrome Web Store rejects them as keyword spam, which is what happened to the first 1.0.89 submission.

## Store privacy disclosures

Keep each store's data disclosure in step with what the extension sends, and update it in the release that changes it:

- **Chrome Web Store:** the item's **Privacy practices** tab declares **Website content** (pages, text and files you save) and **Web history**: while signed in, the saved-page badge sends the address of the page in the active tab to Teak (`GET /v1/cards/duplicate`). A change there can lengthen the store's review.
- **AMO:** `data_collection_permissions` in `wxt.config.ts` already declares `browsingActivity`, which covers the badge's checks.

## Retry and recovery

- Rerun the failed GitHub Actions job when the failure is transient.
- If source or workflow changes are required after a tag exists, ship the fix as the next patch version. Keep published version tags immutable.
- Each job skips publication when its exact versioned zip already exists on the matching GitHub Release, so a rerun of one browser never resubmits the other.
- A frozen-lockfile failure means the version commit did not include the synchronized `bun.lock`; correct it in the next patch.
- The first Chrome Web Store upload and the first AMO listing are manual. Automated publication works only after the item exists in each store.

## Required repository secrets

- `CHROME_EXTENSION_ID`
- `CHROME_PUBLISHER_ID`
- `CHROME_CLIENT_ID`
- `CHROME_CLIENT_SECRET`
- `CHROME_REFRESH_TOKEN`

Generate publisher credentials with the current procedure documented by the Chrome Web Store upload tooling. Keep refresh tokens in GitHub Actions secrets and never persist or print them in repository files or logs.

## AMO (Firefox)

The Firefox build comes from the same source as Chrome (`bun run zip:firefox`). It differs only where Firefox's APIs differ, behind `import.meta.env.BROWSER`. Its manifest has no Chrome `key` or `author`, carries the gecko id `teak@teakvault.com` with `strict_min_version` 140.0, and declares the data Teak sends to its servers (`websiteContent`, `browsingActivity`, `searchTerms`) for Firefox's install prompt. The Firefox build sends no PostHog events or error reports, so it declares no technical data.

### First listing (by hand, once)

1. Build from the release tag with the production environment, as the workflow does:

   ```bash
   VITE_PUBLIC_CONVEX_URL=https://uncommon-ladybug-882.convex.cloud \
   VITE_PUBLIC_CONVEX_SITE_URL=https://uncommon-ladybug-882.convex.site \
   bun run --cwd apps/extension zip:firefox
   ```

   Or download `teak-extension-<version>-firefox.zip` and `teak-extension-<version>-sources.zip` from the GitHub Release.
2. Check it: `npx web-ext@8 lint --source-dir apps/extension/.output/firefox-mv3` must report no errors. Two warnings about `innerHTML` come from React DOM's own code in the popup bundle; Teak never assigns HTML.
3. In the AMO Developer Hub, submit a new add-on, choose "On this site" (listed), and upload the Firefox zip. When AMO asks for source code, upload the sources zip.
4. Fill in the listing: name, summary, description, categories, the support site (`https://teakvault.com/docs/support`), the privacy policy (`https://teakvault.com/docs/privacy-policy`), and the same popup screenshots as the Chrome Web Store listing. Use the slug `teak`, which the docs link to (`https://addons.mozilla.org/firefox/addon/teak/`); if AMO gives another, update `extension.mdx`, `AppsGrid.astro` and the AMO probe to match.
5. Paste the reviewer notes below into "Notes to Reviewer", with a production test account's email and password. Keep that account's credentials only in AMO's private notes and the team's password manager, never in the repository or a log.
6. After approval, install the listed version in a clean Firefox profile and smoke-test sign-in, a page save and address-bar search.

### Reviewer notes

> Teak is a monorepo. The sources zip holds the root manifests, `bun.lock`, the extension (`apps/extension`) and the workspace packages it imports (`packages/convex`, `packages/files-protocol`, `packages/sdk`).
>
> To build: install the Bun and Node versions pinned in the root `package.json` (`packageManager` and `engines.node`), then from the zip's root run
> `bun install --frozen-lockfile`, then
> `VITE_PUBLIC_CONVEX_URL=https://uncommon-ladybug-882.convex.cloud VITE_PUBLIC_CONVEX_SITE_URL=https://uncommon-ladybug-882.convex.site bun run --cwd apps/extension build:firefox`.
> The output in `apps/extension/.output/firefox-mv3` matches the uploaded package file for file.
>
> The same steps are public at https://teakvault.com/docs/extension#build-from-source.
>
> To test: click the Teak toolbar button and sign in with the test account below. The popup saves the open page; the context menu saves pages, images and selected text; typing `teak` and a space in the address bar searches the account's cards.

### Automated releases

After the listing exists, every tag submits through `web-ext sign --channel=listed --upload-source-code teak-extension-<version>-sources.zip --approval-timeout 0`. The step returns once AMO accepts the upload; review continues on AMO. When AMO already has the version, the step reports it and succeeds. Versions move in lockstep with Chrome. If AMO review holds a version while Chrome ships, the next patch replaces it; a short gap between the stores is acceptable.

### Secrets

- `AMO_JWT_ISSUER`
- `AMO_JWT_SECRET`

Create them under "Manage API Keys" in the AMO Developer Hub with the account that owns the listing. The workflow passes them to `web-ext` as `WEB_EXT_API_KEY` and `WEB_EXT_API_SECRET` and never prints them.

### Recovery

- A lint error fails the job before submission. Fix it and ship the next patch.
- If AMO rejects a version, read the review message in the Developer Hub, fix it, and ship the next patch. Do not reupload the same version number; AMO keeps every version number it has seen.
- If the submission step fails after AMO accepted the upload, rerun the job: the step treats "already exists" as done, and the GitHub assets upload again with `--clobber`.
- Credentials that leak or expire: revoke them in the Developer Hub, create new ones, and update both repository secrets.
