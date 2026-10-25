# Docs images

One pipeline makes every image on the docs site and the home page's feature
showcase. Each docs image is a 1600 × 1000 WebP: the store screenshots' meadow
wallpaper with a window on it, either a real capture of the web app or an HTML
mock in Teak's own type, colors and radius. The home page's showcase images are
bare captures; the page draws its own meadow behind them.

| Kind | What it shows | Made by |
| --- | --- | --- |
| `web`, `window` | The whole web app window | `capture.ts` |
| `web`, `focus` | One part of it, such as an open card or a menu, with numbered markers when the page explains them | `capture.ts` |
| `web`, `raw` | A bare capture for `apps/docs/public/home-showcase` | `capture.ts` |
| `mock` | A terminal, chat, editor, browser, email or diagram | `mocks.ts` |

## Files

- `shots.ts`: every image, its alt text (the same text the page uses), and the
  pages that need none (`PAGES_WITHOUT_IMAGES`: the legal pages, Raycast, which
  shows its store's install button, and the Mac and mobile pages until there
  are fresh native captures).
- `seed.ts` and `seed-names.ts`: the cards the Features shots add to the
  store showcase, and the names `capture.ts` opens them by.
- `capture.ts`: signs in to the local stack and captures each web shot into
  `.cache/` (ignored by git), with the steps for each one.
- `mocks.ts`: the HTML for every mock and diagram.
- `render.ts`: frames every shot and writes it as WebP.
- `shots.test.ts`: fails when a page has no image, an image is missing or
  stale, or an alt text drifts from `shots.ts`. It runs with the root
  `bun run test`.

## Refresh the images

1. **Stack.** `bun run dev --detach`. The captures sign in as the account in
   `.agents/.state/stack.json` and show a made-up person (`alex@example.com`)
   instead of it.
2. **Library.** Build the CLI (`bun run build:cli`), point it at the stack's
   backend with an API key (`bun .agents/skills/verify-teak/scripts/api-key.ts mint`,
   then `TEAK_API_KEY` and `TEAK_API_URL`), and run
   `bun scripts/store-assets/seed.ts --apply` so the store showcase cards lead
   the library, then `bun scripts/docs-assets/seed.ts` for what the Features
   shots add: a folder, a note with `[[` links, a note with a table, and a
   Wikipedia article with a highlight (it waits for the article). Link
   previews and AI tags finish a minute later.
3. **Connected app.** The Security shots show the CLI as a connected app: run
   `teak login --no-browser` once against the same backend and finish the
   sign-in in a browser.
4. **Capture.** `bun scripts/docs-assets/capture.ts [name …]`.
5. **Render.** `bun scripts/docs-assets/render.ts [name …]`. Mocks need no
   stack; the WebMCP mock reuses the `library` capture.
6. **Check.** `bun test scripts/docs-assets`, then look at every image before
   committing.

Both scripts use `DOCS_ASSETS_BROWSER` when it's set, then a cloud session's
`TEAK_CLOUD_CHROMIUM`, then Playwright's own Chromium. Mocks use SN Pro from
`apps/docs/public/fonts` and JetBrains Mono for code, falling back to SF Mono
or Menlo.

## Add an image

Add a shot to `shots.ts`, its steps to `PREPARE` in `capture.ts` (for a web
shot) or its HTML to `mocks.ts`, render it, and put it on the page with the
shot's alt text: `![<alt>](./images/<name>.webp)`, or `../images/` from a page
in a group folder.
