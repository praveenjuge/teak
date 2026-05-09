# Extension Release Process

The browser extension ships automatically to the Chrome Web Store and to GitHub Releases through `.github/workflows/extension-release.yml`. Releases are driven by the same tag flow as the desktop app: bump every `package.json`, push the tag, the workflow does the rest.

## How to cut a release

1. Bump the `version` field in **every** `package.json` across the monorepo (root + all workspaces under `apps/*` and `packages/*`). The extension reads its manifest version from `apps/extension/package.json` — `wxt.config.ts` no longer hardcodes it.
2. Commit and push to `main`.
3. Create and push a version tag:
   ```bash
   git tag v<version>
   git push origin v<version>
   ```
4. The `Extension Release` workflow triggers on the `v*` tag and automatically:
   - Verifies the tag version matches `apps/extension/package.json`.
   - Builds the production Chrome zip via `bun run zip` (WXT) with production env vars.
   - Uploads the zip to the Chrome Web Store via the Chrome Web Store Publish API.
   - Publishes the item (submits it for review under the default audience).
   - Uploads the zip to the GitHub Release for tag `v<version>` as `teak-extension-<version>-chrome.zip`.
5. The Chrome Web Store queues the new version for review. Once Google approves it (usually within a few hours to a few days), users receive the update automatically.

The same `v<version>` tag also triggers `desktop-release.yml`, so one tag push releases desktop + extension together.

## Required GitHub secrets

Set these once under **Settings → Secrets and variables → Actions**:

| Secret                    | What it is                                                                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `CHROME_EXTENSION_ID`     | The extension's ID from the Chrome Web Store Developer Dashboard (32-character lowercase string).                                             |
| `CHROME_PUBLISHER_ID`     | The publisher's numeric ID. Open the Developer Dashboard, click into your item, and copy the long ID segment from the URL `…/devconsole/<PUBLISHER_ID>/…`. Needed for the v2 cancelSubmission API. |
| `CHROME_CLIENT_ID`        | OAuth 2.0 client ID from a Google Cloud project with the Chrome Web Store API enabled (Desktop app client type).                             |
| `CHROME_CLIENT_SECRET`    | OAuth 2.0 client secret for the same client.                                                                                                  |
| `CHROME_REFRESH_TOKEN`    | OAuth 2.0 refresh token for the Chrome Web Store publisher account that owns the extension. Generate with `bunx chrome-webstore-upload-keys`. |

### One-time: how to generate the Chrome Web Store credentials

Follow the steps in [fregante/chrome-webstore-upload-keys](https://github.com/fregante/chrome-webstore-upload-keys). Condensed:

1. Go to https://console.developers.google.com/apis/credentials and create a project (e.g. `teak-extension-release`).
2. At https://console.cloud.google.com/auth/overview, set up OAuth (Internal audience is fine).
3. Create an OAuth client of type **Desktop app**. Save the client ID and client secret → these become `CHROME_CLIENT_ID` and `CHROME_CLIENT_SECRET`.
4. Enable the Chrome Web Store API at https://console.cloud.google.com/apis/library/chromewebstore.googleapis.com.
5. Generate the refresh token locally, signed into the same Google account that owns the extension in the Chrome Web Store:
   ```bash
   bunx chrome-webstore-upload-keys
   ```
   Enter the client ID and client secret, approve in the browser, and copy the `REFRESH_TOKEN` value → this becomes `CHROME_REFRESH_TOKEN`.
6. Grab the extension ID from the Chrome Web Store Developer Dashboard → this becomes `CHROME_EXTENSION_ID`.

These credentials are long-lived (refresh tokens do not expire unless revoked) and are reused for every future release.

## First-time prerequisite

The Chrome Web Store API can only publish extensions that already exist in the store. The very first upload must be done manually from the dashboard. After that, every release is automated via the tag push.
