# Sign in and sign out

A signed-out visitor to any app route signs in with email and password on Teak's hosted WorkOS page and lands back in their library. A signed-in visitor goes from a sign-in or sign-up link straight into the app, and teakvault.com shows them "Open Teak". Signing out from Settings or the command palette returns to the hosted sign-in page.

## Sub-features

- `auth-redirect` sends an anonymous visit to any app route to the hosted page (the signed-in layout's loader, `loadAppSession`, redirects; see the Redirect step).
- `auth-sign-in` signs in through the hosted email step, then the password step.
- `auth-return` lands on `next`, or `/` when there is none.
- `auth-signed-in-entry` sends a signed-in visit to `/sign-in` or `/sign-up` straight to `next` (or `/`). `/sign-in?reauth=1` (after a failed callback) and `/sign-in?renew=1` (the app's "Sign in" buttons on "Please sign in again." and "Your session changed") still go through the hosted page.
- `app-loading-frame` paints the app's own wordless frame on a page load before the server has read the session (never a full-screen spinner), its sidebar sized and collapsed per the `sidebar_state` and `sidebar_width` cookies (a head script applies them before paint). When the cards arrive, the server-rendered stand-in grid is `inert` and `aria-hidden` and has no `data-card-id`, so each card's id is on the page once.
- `auth-site-hint` sets cookie `teak_session_hint=1` on sign-in and clears it on sign-out, so teakvault.com's header shows "Open Teak" instead of "Login" and "Register", and its sign-up buttons link to the app.
- `auth-sign-out-settings` signs out from Settings.
- `auth-sign-out-palette` signs out from the command palette.
- `auth-first-sign-in` creates a brand-new WorkOS user's account on first sign-in from the session's claims (address, verification, name); Teak has no WorkOS webhook.
- `auth-first-paint` server-renders a signed-in page load with its content: the sidebar's folders, the first page of cards (Everything with its Pinned row, Favorites, Archive, Trash and manual folders), the Tags list and the Settings account. A search, a smart folder and a brand-new vault still load in the browser. Only a page load's server render runs those queries; the loader's browser calls (client navigations, `router.invalidate()` after a language change) return `seeds: []`. It stays open past the 10-second session timeout while the backend checks the session; only a rejection closes it. During hydration each seeded query renders the server's output (its seed, or loading) even if live data is in, then switches; a page load never logs "Hydration failed", and early input is kept.

## How to get to it (user POV)

- Signed out, open any app URL, such as `<appOrigin>/` or `/settings` (`bun run dev --status` prints the origin).
- Open `/sign-in` directly.
- Signed in: Settings → "Sign out".
- Signed in: Ctrl+K (⌘K on a Mac) → type "sign out" → Enter.
- Signed in: open `/sign-in` or `/sign-up`, as the site's buttons do.
- teakvault.com's header, signed in or out (locally: `bun run --cwd apps/docs build:site`, then `bunx blume preview` in `apps/docs`).

## Driving it with e2e MCP

Preconditions:

- The doctor passes. `open_session` starts signed out.
- The email and password are `account.email` and `account.password` in `.agents/.state/stack.json`.

Steps:

- **Redirect.** `open_session` opens `/`: the first observation is the document "Sign in" on the hosted WorkOS origin (not `localhost`), with heading "Sign in" and textbox "Email". A page load gets there in one redirect: `curl -sD - -o /dev/null -H 'accept: text/html' <app>/settings` answers 307 with `location` on the hosted `/user_management/authorize` and a `wos-auth-verifier` cookie, as does a plain `curl` (`accept: */*`); `accept: application/json` alone answers 406. A client-side navigation (its session check is a server function call) goes to `/sign-in?next=%2Fsettings` instead, which then starts AuthKit as a page load.
- **Email step.** `type` the email into textbox "Email", then `tap` button "Continue with email": the password step, where textbox "Email" shows the address, textbox "Password" is focused, and there's a link "Change email".
- **Password step.** `type` the password into textbox "Password", then `tap` button "Sign in": the app opens on `/`, with heading "Everything", sidebar links "Everything", "Favorites", "Tags", "Archive", "Trash" and "Settings", and the combobox "Search everything". A cold stack can show "Loading cards" for up to a minute.
- **Deep link.** Signed out, `navigate` to `/settings` and sign in: it lands on `/settings` (heading "Settings"), not `/`.
- **Sign out from Settings.** On `/settings` (heading "Settings"), `tap` button "Sign out": the app passes through `/sign-in` (not `/login`) to the hosted page with textbox "Email". `navigate` to `/settings` again: the hosted page, not the app.
- **Signed-in entry.** Signed in, `navigate` to `/sign-in?next=%2Fsettings`: the app opens on `/settings` (heading "Settings"), never leaving `localhost`. `navigate` to `/sign-up`: the app opens on `/`.
- **Site hint.** After sign-in the browser's cookie list (not the screen) has `teak_session_hint=1` on the app's host; after sign-out it is gone. On the built site, with that cookie set for the site's host, the header has "Open Teak" and no "Login" or "Register"; without it, the reverse. Hovering "Register" adds `<link rel="preconnect">` tags for the app and the sign-in hosts.
- **First paint.** Signed in, a scripted `GET /` (session cookies, `accept: text/html`) holds `data-slot="first-paint-grid"` (only placeholder cards means the `cards:searchCardsPaginated` seed is missing or unused: with no seed in the HTML, the query missed the server's 600 ms budget, so load again; with one, its arguments no longer match the grid's, such as `excludePinned` on Everything), and a `layout-shift` `PerformanceObserver` added before load reports no shift on `/` at 1440 and 390 px. `navigate` to `/` (a full page load): once "Loading" is gone, the first `observe` lists card buttons such as "Palette: Citrus" with no "Loading cards" first; likewise `/tags` shows "<n> tags" and `/settings` the account's address. To see the server's HTML alone, load with `/assets/**.js` blocked: the shell, sidebar folders and cards show in even rows that the masonry repacks once scripts run.
- **Hydration keeps early input.** In a script, reload `/` six times; after each, wait for `html[data-hydrated]`, fill combobox "Search everything" at once, wait 3 s and read its value back (the library's lazy chunk hydrates after the root sets `data-hydrated`, so this lands mid-hydration). Every load keeps the text, and no `pageerror` says "Hydration failed".
- **Loading frame.** Signed in, fetch `/` the same way, reading only through the burst holding `data-slot="app-loading-shell"` (before any `data-card-id`). Serve that HTML with `/assets/**.js` blocked and screenshot at 1440 and 390 px: sidebar column, header bar, search field and placeholder cards, no spinner. With cookie `sidebar_state=false` the column is the 48 px rail; `/settings` shows the Settings skeleton beside it. Then load `/` normally and sample `document.querySelectorAll("[data-card-id]").length` every 30 ms through the handoff: it never exceeds the cards shown (30), and `[data-slot="first-paint-grid"]` has `aria-hidden="true"` while it's there.
- **Slow session check.** In a Playwright script, after one warm page load, hold every WebSocket to the stack's Convex backend (the host of `urls.convexUrl` in `stack.json`) with `context.routeWebSocket((url) => url.host === convexHost, () => {})` and load `/` again: the grid and combobox "Search everything" render from the server's data and remain 12 seconds later, with no "We couldn't check your session."
- **Sign out from the palette.** Signed in, with focus outside a text field, `press` "Control+k": dialog "Command palette" with combobox "Search commands, folders and cards". `type` "sign out" and `press` "Enter": the hosted sign-in page appears.

**First sign-in (local E2E stack only).** Needs `bun run dev --local --detach`; run these `convex` commands only with `CONVEX_AGENT_MODE=anonymous`, or they hit the shared dev deployment.

- Create a verified emulator user: `POST <emulatorOrigin>/user_management/users` with `Authorization: Bearer sk_test_default` and `{"email":"dev+verify-<run-id>@example.org","email_verified":true,"first_name":"Verify","last_name":"Run","password":"…"}` (the origin is `urls.emulatorOrigin` in `stack.json`).
- Before sign-in, from `packages/convex`, `env -u CONVEX_DEPLOY_KEY CONVEX_AGENT_MODE=anonymous bunx convex data users --limit 50` has no row with that user's `workosUserId` (the `id` from the POST). The command must report `anonymous deployment`.
- `open_session` and sign in with that address: within a few seconds the app opens on `/` with combobox "Search everything", not "Loading your account" retries. `navigate` to `/settings`: the account's address is shown.
- Proof: the same command now shows one row with that `workosUserId`, `email` the address, `emailVerified: true` and `name: "Verify Run"`.
- Clean up: delete the test account from Settings → Security.

## Gotchas

- Buttons differ: the shared dev deployment's hosted WorkOS (staging) has "Continue with email" and "Sign in"; the local E2E stack's WorkOS emulator has "Continue" for both. Observe before you tap.
- Never use the hosted page's Google, Microsoft, GitHub or Apple links in a run; they leave the app.
- Dev deployment accounts are verified; a "Verify your email" step there means the account is wrong, not the app (an `example.org` address can't receive the code).
- The site sees the hint because production's app is on `app.teakvault.com`. Locally the host-only cookie reaches a site preview on another `localhost` port (cookies ignore ports), but on `127.0.0.1` set it by hand.
- Make brand-new accounts only on the local E2E stack (WorkOS emulator), since staging can't send codes to `example.org`; `src/journey/01-signup.e2e.ts` covers it.
- `navigate` can observe a page load mid-stream (only "Loading"); `observe` again before judging the first paint.
- Sign-out leaves the page at once, so assert the hosted "Email" textbox, not a toast.
- "Sign out <device> (this device)" in Settings → Security also signs you out; don't tap it during other recipes. "Sign out other devices" keeps this browser but ends every other session of the account, other runs' and your own other browsers' included; confirm it only on a throwaway account.
- Each sign-in is its own session: signing in twice from one browser adds a second, alike-named row under Devices, differing by sign-in time and "Last active".
- If the app shows "Please sign in again." or "We couldn't check your session", the session broke: reopen it rather than driving on, and if it recurs, run the doctor and read `.agents/.state/stack.log`.
- Other sign-in page errors, like "Sign-in is temporarily unavailable" (503) or "Invalid sign-in origin." (400), are stack or configuration failures. Run the doctor.
