## Goal

The web app can be installed as an app, and once installed it shows up in the system share sheet where the browser supports Web Share Target (Chromium on Android and ChromeOS, and desktop where the browser allows it). Sharing text or a link opens Teak with the composer filled in. Sharing files uploads them. Teak still needs a connection: no offline support.

Roadmap: [parity roadmap](./2026-10-24-parity-00-roadmap.md), phase 5. One PR, independent of the other phases.

## Success criteria

- **Installable:** Chrome and Edge offer **Install Teak**.
  - The installed app opens on the library in its own window, with Teak's name, icon and theme color in light and dark.
  - Safari's Add to Dock and Add to Home Screen use the same name and icon.
- **Text and links:** sharing a page or text to Teak (Chrome on Android, ChromeOS) opens the library with the composer focused and filled in.
  - A shared link is the link alone.
  - Shared text with a link keeps both, as the composer would.
  - Nothing saves until the person presses Save.
- **Files:**
  - Sharing images, video, audio or documents uploads them through the normal upload queue, with the usual progress, limits and errors.
  - Sharing while signed out goes through sign-in, then continues: text survives as part of the URL. Files are kept on the device until sign-in finishes, or dropped with a message if they can't be.
- **No offline features:**
  - The service worker handles only the share-target POST.
  - With the network off, the installed app shows the browser's normal offline page, as today.
- **Lighthouse:** reports the app as installable, and security header tests still pass.

## Context and current facts

- **No manifest or worker:** `apps/web/src/app` has `icon.svg`, `apple-icon.png` (192×192), `favicon.ico` and `opengraph-image.tsx`. There is no `manifest.ts`, no service worker, no `public/` folder and no 512 px PNG.
- **Theme:**
  - `src/styles/theme.css`: `--background` is white in light and `oklch(0.13 0.028 261.692)` in dark, and `--primary` is `oklch(0.58 0.22 27)` (Teak red).
  - The root layout has no `viewport`/`themeColor` export, and its title default is "Teak" (`app/layout.tsx:37`).
- **Security headers:**
  - `buildContentSecurityPolicy` (`src/lib/security-headers.ts:62-133`) sets `default-src 'self'`, `worker-src 'self' blob:` and `form-action 'self'`. So a same-origin manifest and `/sw.js` are allowed.
  - Tests are in `src/lib/__tests__/securityHeaders.test.ts`.
- **Proxy:**
  - `src/proxy.ts`'s matcher skips any path with a dot (`:84`), so `/manifest.webmanifest` and `/sw.js` are never redirected to sign-in.
  - A dotless path like `/share` is matched. Signed out, it redirects to `/sign-in?next=<path+search>`, and `getSafeNextPath` keeps the query string (`src/lib/safe-next-path.ts:49`).
  - A POST that no worker intercepts would be redirected and lose its body.
- **Composer:**
  - `?compose=1` only focuses the composer (`HomePageClient.tsx:44`, `libraryViews.ts:20`) and is then removed from the URL (`:171-178`).
  - `CardsScreen` owns `draftContentRef` (`:180`), and `AddCardForm` seeds its state from it (`AddCardForm.tsx:111-113`), so it is the place to prefill.
- **Uploads:** `GlobalFileDropProvider` (mounted in `AuthenticatedAppProvider.tsx:44`) exposes `enqueueFiles(files)` through `useGlobalFileDrop()`. It validates files and queues them like a drop.
- **E2E:** nothing in `packages/tests` touches install, the manifest or a service worker.

## Decisions

- **Manifest:**
  - `src/app/manifest.ts` (Next's metadata route, served as `/manifest.webmanifest`):
    - `name` "Teak", `short_name` "Teak", `start_url` "/", `scope` "/", `display` "standalone", `display_override` ["window-controls-overlay"];
    - `background_color` and `theme_color` from the theme as hex;
    - icons at 192 and 512 px, each in `any` and `maskable`.
  - The icons are generated from `icon.svg` by a script and committed under `src/app/`, since there is no `public/`.
  - Add a `viewport` export with `themeColor` for light and dark.
  - The name stays English. The manifest isn't per-language, since the language follows the account, not the URL.
- **Share target:**

  ```json
  "share_target": {
    "action": "/share",
    "method": "POST",
    "enctype": "multipart/form-data",
    "params": { "title": "title", "text": "text", "url": "url",
      "files": [{ "name": "files", "accept": ["image/*", "video/*", "audio/*", "application/pdf", "text/*", "*/*"] }] }
  }
  ```

- **Service worker (`/sw.js`):**
  - It has one job. On a POST to `/share`:
    - it stores the form's files in Cache Storage under a one-time id;
    - it redirects (303) to `/?compose=1&share=<id>&text=…&url=…&title=…`.
  - It has no `fetch` handling for anything else, no precache, and no offline page.
  - It is registered from the authenticated app shell only, after load.
  - A GET to `/share` (no worker yet, or a browser without it) redirects to the same library URL with the text params.
- **Prefill:**
  - A new `?text`, `?url` and `?title` read in `HomePageClient` seeds `draftContentRef`:
    - a lone URL becomes just the URL;
    - otherwise it is title, text and URL on separate lines, without repeating the URL.
  - The params are then stripped, as `compose` is.
- **Files:**
  - With `?share=<id>`, the client reads the cached files, hands them to `enqueueFiles`, and deletes the cache entry.
  - A missing entry (expired or another device) shows "Shared files couldn't be found. Share them again." (translated).
  - Entries older than 1 hour are deleted when the worker starts.
- **Signed out:** the redirect keeps `share=<id>` and the text params through `next`, so files still in the cache upload after sign-in.
- **Not doing:**
  - Offline caching and push notifications.
  - An install prompt UI. The browser's own install button is enough.
  - `navigator.share` (the owner didn't choose it).

## Work

1. `src/app/manifest.ts`, the icons and the icon script, and the `viewport` export.
2. `src/app/sw.js` served as `/sw.js` (a route handler with `Content-Type: text/javascript` and `Service-Worker-Allowed: /`), plus registration in the app shell.
3. A `/share` GET route handler (the fallback redirect).
4. Prefill in `HomePageClient`/`CardsScreen`, and the shared-files hand-off to `enqueueFiles`.
5. Catalogs: the missing-files message and any new aria text, in all 8.
6. Docs: a short "Install the web app" section in `features.mdx` (Apps and access), plus a note in `(apps)/mobile.mdx` that Android's native app is the better share target where it's installed.
7. Verify recipes: a new `features/web-install.md` (install, share text, share files, signed-out share) linked from `features/README.md`.

## Tests

- **Unit:**
  - The manifest's fields and icons.
  - The prefill rules: a lone link; text plus a link without repeating it; title plus text.
  - Param stripping.
  - The missing-cache message.
- **Security headers:** the policy still passes with the worker and the manifest.
- **E2E (`packages/tests/src/web/install.e2e.ts`, Chromium):**
  - `/manifest.webmanifest` is valid and the app is installable (via the `navigator`/CDP installability check).
  - Posting a multipart form to `/share` with a text field and a small PNG ends on the library with the composer filled and the PNG in the upload queue.

## Proof (private artifact page, linked under Proof)

- **Install:** screenshots of the install prompt and the installed window on desktop Chrome, in light and dark, and the Safari Add to Dock result.
- **Share (Android Chrome):** a video on an Android emulator with Chrome, installing Teak, then sharing a page from Chrome and an image from Photos to it, ending on the filled composer and the uploaded image card.
- **Signed-out share:** a video sharing while signed out, signing in, and landing on the filled composer.
- **Captured output:** the Lighthouse installability result; the e2e run; and the response headers of `/sw.js` and `/manifest.webmanifest` with nothing secret in them.
- **Offline:** a screenshot showing the installed app offline still shows the browser's offline page, so offline wasn't added by accident.

## Release gate

1. Run `bun run check`, `bun run --cwd apps/web build` and the new e2e spec.
2. Deploy the web app.
3. Production smoke test: install from Chrome, and share a link to it on an Android device.

## Risks and open questions

- **Two "Teak" targets on Android:** with both the native app and the installed web app, the share sheet lists Teak twice. Acceptable; the docs say which to keep.
- **Browser support:** Web Share Target works in Chromium on Android and ChromeOS, and not on iOS, Firefox or Safari. Installing still works there.
- **Open:** whether `display_override` with window controls overlay fits the web header. Default: leave it out if the header doesn't adapt cleanly at 1440 px.
