# Opening links

On the web, every way to open a link card's page goes one path. A link with an archived copy opens a new tab at `/open/<cardId>`, which checks the page: alive or unsure goes on to the original; gone (404, 410, dead domain) shows Teak's archived copy. A link without a copy opens directly. A page found gone gets an "Archived copy" chip in the card dialog.

## Sub-features

- `open-link-route` opens `/open/<cardId>` for a link with an archived copy, and the page itself for any other card; middle-click and "Copy link address" on the dialog's link keep the original address.
- `open-check` shows "Opening <host>…", then "Open the original now" after 1.5 s, and goes on to the original by 4 s at the latest; a cached answer (alive for 24 hours, dead for 6) skips the check.
- `archive-view` shows the bar ("Archived copy", "This page is no longer available · Saved <date> from <host>", "Try the original ↗", "Open in Teak") over the copy in a sandboxed frame on white; at 390 px the text reads "No longer available" and the two buttons move into a ⋯ menu.
- `archive-missing` shows "Teak’s copy couldn’t be loaded." with "Try the original ↗" when the copy's object is gone.
- `open-unavailable` shows the Teak wordmark, heading "This card isn’t available.", "It may have been deleted, or the link is wrong." and the button link "Back to Teak" (laid out like "Page not found") for another account's card, a card in Trash, a note or a non-card address. The tab reads "Card not available · Teak", not "Opening link".
- `dead-chip` shows the "Archived copy" chip after the site in the card dialog, with the tooltip "The original page was gone when last checked on <date>".

## How to get to it (user POV)

- Hover a link card → "Open link", or open the card → its title, image or open-link shortcut.
- Type `/open/<cardId>` in a signed-in tab.
- Open a card whose page was found gone: the chip sits beside the site.

## Driving it with e2e MCP

Preconditions:

- Seed the `dead-links` pack on the signed-in account (on dev its links point at httpbin.org):
  - `bunx convex run devSeed:seedScenario '{"workosUserId":"<id>","scenario":"dead-links"}'`
- On the local E2E stack the link fetcher only reaches a local server. Start one that answers `/status/<code>` with that status (for example `bun -e 'Bun.serve({port:4590,fetch:(r)=>new Response(null,{status:Number(new URL(r.url).pathname.split("/")[2])||200})})'`), then seed with `"origin":"http://1.1.1.1/teak-e2e-forward/4590"` and prefix the command with `env -u CONVEX_DEPLOY_KEY CONVEX_AGENT_MODE=anonymous`.
- Search `#scenario-dead-links`. A copy whose page never loads shows the missing state.

Steps:

- **Gone.** Hover "Gone: 404" → "Open link": a new tab at `/open/<id>` shows "Opening httpbin.org…", then the `archive-view` bar ("Saved Oct 19, 2026 from httpbin.org") and the frame. `observe` the frame: `sandbox` is `allow-popups allow-popups-to-escape-sandbox` (no `allow-scripts`), and the copy reads "Scripts are blocked in this copy." Repeat for "Gone: 410", "Gone: the domain no longer exists" and "Gone, kept as text only" (copy starts "Text-only copy").
- **Cached.** Reopen "Gone: 404" within 6 hours: no "Opening…" step.
- **Alive or unsure.** "Alive: 200 (opens the original)", "Refused: 403 (opens the original)" and "Broken: 500 (opens the original)" each go on to the original, leaving no `/open` history entry. "Slow: answers after 6 seconds (opens the original)" shows "Open the original now" at 1.5 s and goes on at 4 s.
- **No copy.** "Open link" on "Gone, with no copy (opens the original)" opens the httpbin URL directly, never `/open`.
- **Try the original.** `click` "Try the original ↗": the real 404 loads in the same tab; Back returns to the copy. "Open in Teak" opens the library with the card's dialog.
- **Dialog chip.** Open "Gone: 404" in Teak: the chip sits after "httpbin.org" with its tooltip; the title link's `href` is still the httpbin address.
- **Unavailable.** `/open/not-a-card` and `/open/<id of "Gone, in Trash">` show the `open-unavailable` page and tab title.
- **390 px and dark.** At 390 × 844 the bar reads "No longer available" and the "More actions" button's menu has both buttons. In dark the bar follows; the frame stays white.
- **Keyboard.** `press` "Tab": focus reaches the bar's buttons before the frame; "Escape" does nothing.
- **End to end (local stack).** `bun run --cwd packages/tests e2e src/web/dead-link.e2e.ts`.

## Gotchas

- Only a click checks a page; nothing crawls. Past 30 checks a minute an open goes straight to the original, silently.
- An unsure answer (403, 429, 5xx, timeout, TLS error, too many redirects) opens the original and is never cached.
- A 200 with a "not found" message, or a redirect to a home page, counts as alive.
- Only the web goes through `/open`; native apps, Raycast, the extension and the API open the original.
- Signed out, `/open/<id>` goes through sign-in and back to the same tab.
