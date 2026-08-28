# Browser extension release

The Chrome extension ships through `.github/workflows/extension-release.yml` to the Chrome Web Store and the matching GitHub Release.

## Canonical release

1. Update every tracked `package.json` to the same next patch version.
2. Run `bun install` to synchronize `bun.lock`, then prove `bun install --frozen-lockfile` exits successfully.
3. Merge the scoped version and lockfile change to `main`.
4. `Version Tag` verifies the patch and lockstep invariants, creates `v<version>`, and dispatches every product release for that tag.
5. `Extension Release` verifies the extension version, builds the production Chrome zip, submits it to the Chrome Web Store, and attaches `teak-extension-<version>-chrome.zip` to the matching GitHub Release.
6. Verify the workflow and GitHub artifact, then check the Chrome Web Store submission state. Store review may continue after the workflow succeeds.

The release is complete when the exact zip is attached to the GitHub Release and the store has accepted the submission for review.

## Retry and recovery

- Rerun the failed GitHub Actions job when the failure is transient.
- If source or workflow changes are required after a tag exists, ship the fix as the next patch version. Keep published version tags immutable.
- The workflow skips publication when the exact versioned zip already exists on the matching GitHub Release.
- A frozen-lockfile failure means the version commit did not include the synchronized `bun.lock`; correct it in the next patch.
- The first Chrome Web Store upload is manual. Automated publication works only after the item exists in the store.

## Required repository secrets

- `CHROME_EXTENSION_ID`
- `CHROME_PUBLISHER_ID`
- `CHROME_CLIENT_ID`
- `CHROME_CLIENT_SECRET`
- `CHROME_REFRESH_TOKEN`

Generate publisher credentials with the current procedure documented by the Chrome Web Store upload tooling. Keep refresh tokens in GitHub Actions secrets and never persist or print them in repository files or logs.
