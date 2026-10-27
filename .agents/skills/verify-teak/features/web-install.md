# Installed web app

Teak's web app can be installed from Chrome, Edge or Safari: it opens on the library in its own window with Teak's name, icon and theme color. Installed in Chromium on Android or ChromeOS, it is a share target: a shared page or text opens the library with the composer filled in (a link alone, or title, text and link on their own lines), shared files upload through the normal upload queue, and a share made while signed out continues after sign-in. Nothing is cached for offline use.

## Sub-features

- `web-install-manifest` serves `/manifest.webmanifest` (name "Teak", `start_url` and `scope` "/", standalone, four PNG icons under `/icons/`, and `share_target` posting multipart to `/share`), and `theme-color` metas for light (`#ffffff`) and dark (`#030712`).
- `web-install-worker` serves `/sw.js` (`text/javascript`, `Service-Worker-Allowed: /`) and registers it on every page after load. It answers only a POST to `/share`: files go into the `teak-share` cache under `/__share/<id>/<n>`, and it redirects 303 to `/?compose=1&title=…&text=…&url=…&share=<id>`. Entries older than an hour are deleted.
- `web-install-share-text` fills the composer from `title`, `text` and `url` and strips them from the URL with `compose`.
- `web-install-share-files` hands the kept files to the upload queue ("File uploaded"), and deletes them from the cache; gone files show "Shared files couldn't be found. Share them again." In the installed app's window (`display-mode: standalone`) they upload at once. In a browser tab, where any website could have posted the form, the toast "Save the shared file to Teak?" (or "Save N shared files to Teak?") waits, and nothing uploads until its "Save". While it waits, the files stay in the cache and `share=<id>` stays in the URL, so a reload asks again; "Save" or closing the toast deletes them and drops the id.
- `web-install-share-fallback` is the `/share` route for a POST no worker answered: it keeps the text and adds `share=missing` when the form had files. It is never redirected to sign-in first.
- `web-install-signed-out` keeps the share's text and file id through `/sign-in?next=…`, so both land after sign-in.

## How to get to it (user POV)

- Desktop Chrome or Edge: the install icon in the address bar, or the menu's **Install Teak**. Safari: **File → Add to Dock**, or **Share → Add to Home Screen** on iPhone.
- Android Chrome or ChromeOS, once installed: any app's **Share** → **Teak**.

## Driving it with the e2e runner and curl

- `bunx e2e run src/web/install.e2e.ts` from `packages/tests` against the local E2E stack covers the manifest and icons, a share with text and a PNG (composer filled, URL cleaned, a reload that asks again, the browser-tab prompt's "Save" tapped, URL cleaned, image card in the backend), and a signed-out share that continues after sign-in. Add `--video on` for proof; the videos land in `.e2e/chromium/results/`.
- `curl -sI <web>/sw.js` shows the worker's headers; `curl -s -i -X POST -F text=hi -F files=@<png> <web>/share` shows the fallback's 303 to `/?compose=1&text=hi&share=missing`.
- A real share sheet needs an Android emulator with Chrome and a reachable HTTPS origin; the local stack is plain http on localhost, which Chrome only installs on the same machine.

## Gotchas

- The Claude desktop app's built-in browser doesn't register service workers ("An unknown error occurred when fetching the script"); use the e2e runner's Chromium.
- The worker takes over a page only after it activates; wait for `navigator.serviceWorker.controller` before posting a share from a test page.
- The hosted sign-in page is another origin, but a form posted from it to Teak's `/share` still goes through Teak's worker, because navigations into its scope always do.
