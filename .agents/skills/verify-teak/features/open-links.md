# Opening links

Opening a link card's page goes through one path on the web: the grid's "Open link" quick action, the card dialog's link (its title and image) and the dialog's open-link shortcut. A link with an archived copy opens a new tab at `/open/<cardId>`, which checks the page first: when it is alive, or the check isn't sure, the tab goes straight on to the original; when it is gone (404, 410 or a domain that no longer exists), the tab shows Teak's archived copy under an "Archived copy" bar. A link without a copy opens its page directly. Once a check finds the page gone, the card dialog shows an "Archived copy" chip beside the site.

## Sub-features

- `open-link-route` opens `/open/<cardId>` for a link with an archived copy, and the page itself for any other card; middle-click and "Copy link address" on the dialog's link keep the original address.
- `open-check` shows "Opening <host>…", then "Open the original now" after 1.5 s, and goes on to the original by 4 s at the latest; a cached answer (alive for 24 hours, dead for 6) skips the check.
- `archive-view` shows the bar ("Archived copy", "This page is no longer available · Saved <date> from <host>", "Try the original ↗", "Open in Teak") over the copy in a sandboxed frame on white; at 390 px the text reads "No longer available" and the two buttons move into a ⋯ menu.
- `archive-missing` shows "Teak’s copy couldn’t be loaded." with "Try the original ↗" when the copy's object is gone.
- `open-unavailable` shows the Teak wordmark, heading "This card isn’t available.", "It may have been deleted, or the link is wrong." and the button link "Back to Teak", laid out like the app's "Page not found", for another account's card, a card in Trash, a note or an address that is no card. The tab reads "Card not available · Teak", not "Opening link".
- `dead-chip` shows the "Archived copy" chip after the site in the card dialog, with the tooltip "The original page was gone when last checked on <date>".

## How to get to it (user POV)

- Hover a link card → "Open link". Or open the card → click its title or image, or press its open-link shortcut.
- Type `/open/<cardId>` in the address bar of a signed-in tab.
- Open a card whose page was found gone: the chip sits beside the site under the title.

## Driving it with e2e MCP

Preconditions:

- Seed the `dead-links` pack on the signed-in account. On the dev deployment its links point at httpbin.org:
  - `bunx convex run devSeed:seedScenario '{"workosUserId":"<id>","scenario":"dead-links"}'`
- On the local E2E stack the link fetcher is a stand-in that only reaches a local server. Start one that answers `/status/<code>` with that status (for example `bun -e 'Bun.serve({port:4590,fetch:(r)=>new Response(null,{status:Number(new URL(r.url).pathname.split("/")[2])||200})})'`), then seed with `"origin":"http://1.1.1.1/teak-e2e-forward/4590"` and prefix the command with `env -u CONVEX_DEPLOY_KEY CONVEX_AGENT_MODE=anonymous`.
- The pack's cards are tagged `scenario-dead-links`; search `#scenario-dead-links`. Its copies are small pages written right after the cards; one whose page never loads shows the missing state.

Steps:

- **Gone.** Hover "Gone: 404" → "Open link": a new tab opens at `/open/<id>`, shows "Opening httpbin.org…" briefly, then the heading "Archived copy", the text "This page is no longer available · Saved Oct 19, 2026 from httpbin.org" and the frame. `observe` the frame: its `sandbox` is `allow-popups allow-popups-to-escape-sandbox`, with no `allow-scripts`, and the copy reads "Scripts are blocked in this copy." Do the same for "Gone: 410", "Gone: the domain no longer exists" and "Gone, kept as text only" (its copy starts with "Text-only copy").
- **Cached.** Open "Gone: 404" again within 6 hours: the copy shows with no "Opening…" step.
- **Alive or unsure.** Open "Alive: 200 (opens the original)", "Refused: 403 (opens the original)", "Broken: 500 (opens the original)": each tab goes on to the original and keeps no `/open` entry to go back to. "Slow: answers after 6 seconds (opens the original)" shows "Open the original now" after 1.5 s and goes on by itself at 4 s.
- **No copy.** Hover "Gone, with no copy (opens the original)" → "Open link": the tab opens the httpbin URL directly, never `/open`.
- **Try the original.** In the archive tab, `click` "Try the original ↗": the real 404 loads in the same tab; Back returns to the copy. `click` "Open in Teak": the library opens with the card's dialog.
- **Dialog chip.** Open "Gone: 404" in Teak: "Archived copy" sits after "httpbin.org"; hover it for the tooltip. `observe` the title link: its `href` is still the httpbin address.
- **Unavailable.** Open `/open/not-a-card` and `/open/<id of "Gone, in Trash">`: heading "This card isn’t available." with link "Back to Teak", and the tab title "Card not available · Teak".
- **390 px and dark.** Resize to 390 × 844 in the archive tab: the bar reads "Archived copy" "No longer available" and a "More actions" button; its menu has "Try the original ↗" and "Open in Teak". Switch to dark: the bar follows, the frame stays white.
- **Keyboard.** In the archive tab, `press` "Tab": focus reaches the bar's buttons before the frame; `press` "Escape": nothing happens.
- **End to end (local stack).** `bun run --cwd packages/tests e2e src/web/dead-link.e2e.ts`.

## Gotchas

- Only a click checks a page; nothing crawls. Past 30 checks a minute an open goes straight to the original, with no message.
- An answer Teak isn't sure of (403, 429, 5xx, a timeout, a TLS error, too many redirects) always opens the original and is never kept, so the next open checks again.
- A page that answers 200 with a "not found" message, or redirects to a home page, counts as alive.
- Native apps, Raycast, the extension and the API open the original directly; only the web goes through `/open`.
- Signed out, `/open/<id>` goes through sign-in and comes back to the same tab.
