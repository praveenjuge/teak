# Saved copies of pages

Every saved link gets a private copy of its page: one HTML file with text, styles, fonts and images inlined (up to 20 MB, text-only past that), made by the last card-processing step. The Chrome and Firefox extensions send the page as the browser shows it. The side panel's **Details** shows the copy's state; the API, SDK and CLI show `archive: { kind, bytes, capturedAt }`.

## Sub-features

- `archive-row` shows the Details row "Archived copy" with the size ("2.4 MB"), "Text only", "Saving a copy…" with a skeleton bar, or "Couldn't save a copy" with an info tooltip giving the reason: gone (404, 410); bot-blocked (401, 402, 403, 429, 451, challenge page), pointing to the extension; another site error, pointing to "Refresh details"; or unreachable.
- `archive-retry` retries 408, 425, 429 or 5xx up to three more times, 30 seconds apart, before failing.
- `archive-server` archives links saved from the web, Raycast, the apps or the API from the page Teak fetches.
- `archive-extension` archives the page the extension sends, with password, hidden, one-time-code and card-number fields cleared.
- `archive-refresh` saves a new copy on "Refresh details".
- `archive-api` returns `archive` on cards, takes `POST /v1/page-snapshots/upload` and `pageSnapshotKey` on `POST /v1/cards`.
- `archive-object` serves the copy with a sandbox CSP, so it never runs script.

## How to get to it (user POV)

- Save a link, open the card, read **Details** in the side panel.
- Save a page from the extension (popup, ⌥⇧S, or right-click → **Save Page**), then open the card.
- The card's **More** menu → "Refresh details".

## Driving it with e2e MCP and the API

Preconditions:

- Seed the pack on the signed-in account (local stack shown; on the dev deployment, drop the `env` prefix):
  `env -u CONVEX_DEPLOY_KEY CONVEX_AGENT_MODE=anonymous bunx convex run devSeed:seedScenario '{"workosUserId":"<id>","scenario":"page-archive-mix"}'`
- The local E2E stack has no link-fetch Container (no Docker), so a live save there ends "Couldn't save a copy" with "The page couldn't be reached"; an extension save or `POST /v1/page-snapshots/upload` still archives.

Steps:

- **States.** Search `#scenario-page-archives`; each card's Details row reads: "A full copy, 40 KB…": "Archived copy" and a size; "A page too large to keep whole": "Text only"; "A copy still being saved": "Saving a copy…"; "A page Teak can't open": "Couldn't save a copy", its focused info button "Teak can't open this page"; "A page that no longer exists": "The page no longer exists"; "A site that turns Teak away": "The site turns away automated visitors. Save the page with the Teak browser extension to keep a copy." Capture each in light and dark, at 390 and 1440 px.
- **Live save.** Save `https://example.com`: the tile shows no processing state for the copy; Details moves from "Saving a copy…" to "Archived copy". `GET /v1/cards/<id>` has `archive.kind: "full"`; `bun apps/cli/src/index.ts cards get <id> --json` prints the same.
- **Snapshot through the API.** gzip a small HTML page, `POST /v1/page-snapshots/upload` with `{ "bytes": <gzip size> }`, `PUT` it to `uploadUrl` with `Content-Type: application/gzip`, then `POST /v1/cards` with `url` and `pageSnapshotKey`; `archive` appears. 20 MiB + 1 `bytes` answers `413 PAGE_SNAPSHOT_TOO_LARGE`; another account's key saves without the snapshot.
- **Extension.** With the extension signed in ([Browser extension](./extension.md)), type a word into a page's search box and a password into its password field, then press ⌥⇧S. Read the stored copy through a signed file URL (Local Explorer on the local stack): the word is there, the password is not.
- **Object.** The copy's signed URL answers with `Content-Security-Policy: sandbox; default-src 'none'; …` and `Cross-Origin-Resource-Policy: cross-origin`; opened in a tab, DevTools shows scripts blocked.
- **Refresh.** "Refresh details" on an archived card: `archive.capturedAt` moves forward and the old object is deleted.

## Gotchas

- The copy comes after the summary, up to a few minutes on a slow page. The screenshot is taken from a full copy; otherwise from the fetched page.
- A failed copy never fails the card.
- An `<img>` at a private address or `file:` becomes a grey box: the SSRF policy working.
- JavaScript-only pages archive near-empty from the server; the extension's copy is full.
- Safari keeps server copies only; its extension sends no page.
