# Installed web app

Teak's web app installs from Chrome, Edge or Safari and opens on the library in its own window. In Chromium on Android or ChromeOS it is also a share target: text fills the composer (a link alone, or title, text and link on their own lines) and files go through the upload queue. Nothing is cached for offline use.

## Sub-features

- `web-install-manifest` serves `/manifest.webmanifest` as a static file (`application/manifest+json`, no `cf-placement` or CSP header; built from `apps/web/src/lib/installFiles.ts`) with name "Teak", `start_url` and `scope` "/", standalone, four PNG icons under `/icons/`, and `share_target` posting multipart to `/share`; plus `theme-color` metas for light (`#ffffff`) and dark (`#030712`).
- `web-install-worker` serves `/sw.js` as a static file (`text/javascript`, `Service-Worker-Allowed: /`, `Cache-Control: no-cache` from `public/_headers`), registered on every page after load. It answers only a POST to `/share`: files go into the `teak-share` cache under `/__share/<id>/<n>`, and it redirects 303 to `/?compose=1&title=…&text=…&url=…&share=<id>`. Entries older than an hour are deleted.
- `web-install-share-text` fills the composer from `title`, `text` and `url` and strips them and `compose` from the URL.
- `web-install-share-files` moves the cached files to the upload queue ("File uploaded"); gone files show "Shared files couldn't be found. Share them again." In the installed window (`display-mode: standalone`) they upload at once; in a browser tab (any site could have posted the form) only after "Save" on the toast "Save the shared file to Teak?" (or "Save N shared files to Teak?"). Until then the tab keeps the share id in sessionStorage `teak:pending-share`, so a reload asks again; "Save" or closing the toast deletes the files and the id.
- `web-install-share-fallback` is the `/share` route for a POST no worker answered: it keeps the text, adds `share=missing` if files were posted, and never redirects to sign-in first.
- `web-install-signed-out` keeps a signed-out share's text and file id through sign-in (AuthKit returns to the same URL).

## How to get to it (user POV)

- Chrome or Edge: the address bar's install icon or **Install Teak**. Safari: **File → Add to Dock**; iPhone: **Share → Add to Home Screen**.
- Android Chrome or ChromeOS, once installed: any app's **Share** → **Teak**.

## Driving it with the e2e runner and curl

- `bunx e2e run src/web/install.e2e.ts` from `packages/tests` (local E2E stack) covers the manifest and icons, a text-and-PNG share (composer filled, URL cleaned, reload asks again, "Save", image card in the backend), and a signed-out share. `--video on` records proof into `.e2e/chromium/results/`.
- `curl -sI <web>/sw.js` shows the worker's headers; `curl -s -i -X POST -F text=hi -F files=@<png> <web>/share` shows the fallback's 303 to `/?compose=1&text=hi&share=missing`.
- A real share sheet needs an Android emulator with Chrome and an HTTPS origin; Chrome installs the plain-http local stack only on its own machine.

## Gotchas

- The Claude desktop app's built-in browser doesn't register service workers ("An unknown error occurred when fetching the script"); use the e2e runner's Chromium.
- Wait for `navigator.serviceWorker.controller` before posting a share from a test page.
- A form posted to `/share` from the hosted sign-in page (another origin) still hits Teak's worker: navigations into its scope always do.
