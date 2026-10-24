# Saved copies of pages

Every link a user saves gets a private copy of its page: one HTML file with its text, styles, fonts and images inlined (up to 20 MB, text-only past that), made by the last card-processing step. Saving from the Chrome or Firefox extension sends the page as the browser shows it, so the copy matches what the user saw. The card's side panel shows the copy's state in **Details**; the API, SDK and CLI show `archive: { kind, bytes, capturedAt }`.

## Sub-features

- `archive-row` shows the Details row "Archived copy" with the size ("2.4 MB"), "Text only", "Saving a copy…" with a skeleton bar, or "Couldn't save a copy" with an info button whose tooltip gives the reason.
- `archive-server` archives a link saved from the web, Raycast, the apps or the API from the page Teak fetches.
- `archive-extension` archives the page the extension sends from the popup, ⌥⇧S or the context menu's **Save Page**, with password, hidden, one-time-code and card-number fields cleared.
- `archive-refresh` saves a new copy on "Refresh details".
- `archive-api` returns `archive` on cards, takes `POST /v1/page-snapshots/upload` and `pageSnapshotKey` on `POST /v1/cards`.
- `archive-object` serves the stored copy with a sandbox CSP, so it runs no script wherever it is opened.

## How to get to it (user POV)

- Save a link with the composer, open the card, and read **Details** in the side panel: "Saving a copy…" turns into "Archived copy" with a size.
- Save a page from the browser extension (popup, ⌥⇧S, or right-click → **Save Page**), then open the card in Teak.
- The card's **More** menu → "Refresh details".

## Driving it with e2e MCP and the API

Preconditions:

- Seed the pack on the signed-in account (local stack shown; on the dev deployment, drop the `env` prefix):
  `env -u CONVEX_DEPLOY_KEY CONVEX_AGENT_MODE=anonymous bunx convex run devSeed:seedScenario '{"workosUserId":"<id>","scenario":"page-archive-mix"}'`
- Server archives need the link-fetch Container, which the local E2E stack doesn't run (no Docker): a live save there ends "Couldn't save a copy" with "The page couldn't be reached". An extension save, or `POST /v1/page-snapshots/upload`, archives without it.

Steps:

- **States.** Search `#scenario-page-archives`. Open each card and read the Details row: "A full copy, 40 KB…" reads "Archived copy" and a size; "A page too large to keep whole" reads "Text only"; "A copy still being saved" reads "Saving a copy…"; "A page Teak can't open" reads "Couldn't save a copy", and focusing its info button shows "Teak can't open this page". Capture each in light and dark, at 390 and 1440 px.
- **Live save.** Save `https://example.com` with the composer. The card tile shows no processing state for the copy; the side panel moves from "Saving a copy…" to "Archived copy". Proof: `GET /v1/cards/<id>` has `archive.kind: "full"`; `bun apps/cli/src/index.ts cards get <id> --json` prints the same.
- **Snapshot through the API.** gzip a small HTML page, `POST /v1/page-snapshots/upload` with `{ "bytes": <gzip size> }`, `PUT` it to `uploadUrl` with `Content-Type: application/gzip`, then `POST /v1/cards` with `url` and `pageSnapshotKey`. Wait for `archive` on the card. A 20 MiB + 1 `bytes` answers `413 PAGE_SNAPSHOT_TOO_LARGE`; another account's key saves the card without the snapshot.
- **Extension.** With the extension signed in ([Browser extension](./extension.md)), type a word into a page's search box and a password into its password field, press ⌥⇧S, then open the card in Teak. Read the stored copy through a signed file URL (Local Explorer on the local stack): the search word is there, the password is not.
- **Object.** Fetch the copy's signed URL: the response has `Content-Security-Policy: sandbox; default-src 'none'; …` and `Cross-Origin-Resource-Policy: cross-origin`; open it in a tab and DevTools shows scripts blocked.
- **Refresh.** "Refresh details" on an archived card: `archive.capturedAt` moves forward and the old object is deleted.

## Gotchas

- The copy is the last step: a link's summary and screenshot come first, and the copy can take up to a few minutes on a slow page.
- A copy never fails the card: "Couldn't save a copy" sits beside a finished card.
- A page whose `<img>` points at a private address or `file:` keeps a grey box in its place; that's the SSRF policy working.
- JavaScript-only pages saved from the web archive near-empty; the extension's copy is the full page.
- Safari keeps server copies only; its extension sends no page.
