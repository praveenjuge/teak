# Sign in and sign out

A signed-out visitor to any app route is sent to Teak's hosted WorkOS sign-in page, signs in with email and password, and lands back in their library. A signed-in visitor who opens a sign-in or sign-up link goes straight into the app, and teakvault.com shows them "Open Teak" instead of Login and Register. Signing out from Settings or the command palette ends the session and returns to the hosted sign-in page.

## Sub-features

- `auth-redirect` sends an anonymous page load straight to the hosted page, which returns to the same path after sign-in. A Next.js router fetch (no `text/html` in `Accept`) goes to `/sign-in?next=<path>` instead, which answers it with an empty 204 so the router reloads the page.
- `auth-sign-in` signs in through the hosted email step, then the password step.
- `auth-return` lands on `next`, or `/` when there is none.
- `auth-signed-in-entry` sends a signed-in visit to `/sign-in` or `/sign-up` straight to `next` (or `/`) without the hosted page. `/sign-in?reauth=1` (after a failed callback) and `/sign-in?renew=1` (the app's "Sign in" buttons on "Please sign in again." and "Your session changed") still go through the hosted page.
- `auth-site-hint` marks the browser signed in for teakvault.com (cookie `teak_session_hint=1`) after sign-in and clears it on sign-out. The site's header then shows "Open Teak" instead of "Login" and "Register", and its sign-up buttons link to the app.
- `auth-sign-out-settings` signs out from the Settings page.
- `auth-sign-out-palette` signs out from the command palette.
- `auth-first-sign-in` gives a brand-new WorkOS user a vault on their first sign-in: the signed session's claims (address, verification, name) create the account. Teak has no WorkOS webhook.
- `auth-first-paint` serves a signed-in page load with its content already in the page: the sidebar's folders, the first page of cards (Everything, Favorites, Archive, Trash and manual folders), the Tags list and the Settings account. A search, a smart folder's cards and a brand-new account's vault still load in the browser. Only a page load (a request that accepts `text/html`) runs those queries: the router's own fetches, such as the refresh after every token renewal, carry `seeds: []`. While the backend is still checking the session, an app opened this way stays open past the 10-second session timeout; only a rejected session closes it.

## How to get to it (user POV)

- Open any app URL, such as `http://localhost:3000/` or `/settings`, while signed out.
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

- **Redirect.** `open_session` opens `/`. The first observation's document is "Sign in" on the hosted WorkOS origin, with heading "Sign in" and textbox "Email". The URL is no longer `localhost`. A page load goes there in one redirect: `curl -sD - -o /dev/null -H 'accept: text/html' <app>/settings` answers 307 with `location` on the hosted `/user_management/authorize` and a `wos-auth-verifier` cookie, not `/sign-in`.
- **Email step.** `type` the email into textbox "Email", then `tap` button "Continue with email". The page changes to the password step: textbox "Email" shows the address, textbox "Password" is focused, and there's a link "Change email".
- **Password step.** `type` the password into textbox "Password", then `tap` button "Sign in". The app opens on `/`, with heading "Everything", sidebar links "Everything", "Favorites", "Tags", "Archive", "Trash" and "Settings", and the combobox "Search everything". Cards may show as the status "Loading cards" for up to a minute on a cold stack.
- **Deep link.** Signed out, `navigate` to `/settings`, then sign in. The app lands on `/settings` (heading "Settings"), not `/`.
- **Sign out from Settings.** `navigate` to `/settings`, wait for heading "Settings", `tap` button "Sign out". The app passes through `/sign-in` (not `/login`), and the hosted page with textbox "Email" appears. Proof: `navigate` to `/settings` again; it lands on the hosted page, not the app.
- **Signed-in entry.** Signed in, `navigate` to `/sign-in?next=%2Fsettings`. The app opens on `/settings` (heading "Settings") and the URL never leaves `localhost`. `navigate` to `/sign-up`: the app opens on `/`.
- **Site hint.** After signing in, the browser holds cookie `teak_session_hint` with value `1` on the app's host (read it with the browser's cookie list, not the screen). After signing out it is gone. On the built site, with that cookie set for the site's host, the header has link "Open Teak" and no "Login" or "Register"; without it, the reverse. Hovering "Register" adds `<link rel="preconnect">` tags for the app and the sign-in hosts.
- **First paint.** Signed in, `navigate` to `/` (a full page load). Once the status "Loading" is gone, the first `observe` lists card buttons such as "Palette: Citrus" with no status "Loading cards" before them; `/tags` shows "<n> tags" and `/settings` the account's address the same way. To see the server's HTML alone, load the page with the app's scripts blocked (`/_next/static/**.js`): the shell, sidebar folders and cards are on screen, laid out in even rows that the masonry repacks once the scripts run.
- **Slow session check.** In a script with Playwright, after one warm page load, hold every WebSocket to the stack's Convex backend (the host of `urls.convexUrl` in `stack.json`, on the dev stack or the local one) with `context.routeWebSocket((url) => url.host === convexHost, () => {})` and load `/` again: the grid and combobox "Search everything" appear from the server's data and are still there 12 seconds later, with no "We couldn't check your session."
- **Sign out from the palette.** Signed in, with focus outside a text field, `press` "Control+k". Dialog "Command palette" opens with the combobox "Search commands, folders and cards". `type` "sign out", `press` "Enter". The hosted sign-in page appears.

**First sign-in (local E2E stack only).** It needs `bun run dev --local --detach` and reads only that stack's backend; never run these `convex` commands without `CONVEX_AGENT_MODE=anonymous`, which would hit the shared dev deployment instead.

- Create a verified user in the emulator: `POST <emulatorOrigin>/user_management/users` with `Authorization: Bearer sk_test_default` and `{"email":"dev+verify-<run-id>@example.org","email_verified":true,"first_name":"Verify","last_name":"Run","password":"…"}` (the origin is `urls.emulatorOrigin` in `stack.json`).
- Before signing in, from `packages/convex`, `env -u CONVEX_DEPLOY_KEY CONVEX_AGENT_MODE=anonymous bunx convex data users --limit 50` has no row with that user's `workosUserId` (the `id` from the POST). The command must report `anonymous deployment`.
- `open_session`, sign in with that address (both emulator buttons are "Continue"). The app opens on `/` with the combobox "Search everything" within a few seconds, not "Loading your account" retries. `navigate` to `/settings`: the account's address is shown.
- Proof: the same `convex data users` command now shows one row with that `workosUserId`, `email` the address, `emailVerified: true` and `name: "Verify Run"`.
- Clean up: delete the test account from Settings → Security.

## Gotchas

- The shared dev deployment uses real hosted WorkOS (staging), whose buttons are "Continue with email" and "Sign in". The local E2E stack uses the WorkOS emulator, whose buttons are both "Continue". Observe before you tap.
- The hosted page's Google, Microsoft, GitHub and Apple links leave the app. Never use them in a run.
- Accounts on the dev deployment are verified. An `example.org` address that WorkOS asks to verify can't receive the code, so a "Verify your email" step there means the account is wrong, not the app.
- The site reads the hint on teakvault.com only because production's app is on `app.teakvault.com`. Locally the cookie is host-only, so a preview of the site on another port of `localhost` sees it too (cookies ignore ports), but on `127.0.0.1` it needs setting by hand.
- A brand-new account can only be made on the local E2E stack (WorkOS emulator): staging can't send codes to `example.org`. `src/journey/01-signup.e2e.ts` covers it.
- `navigate` can observe a page load mid-stream, showing only the status "Loading"; `observe` again before judging the first paint.
- Sign-out leaves the page at once, so its toasts vanish. Assert the hosted "Email" textbox, not a toast.
- "Sign out <device> (this device)" in Settings → Security also signs you out. Don't tap it during other recipes. "Sign out other devices" never signs out this browser, but it ends every other session of the account, including other runs' and your own other browsers'; confirm it only on a throwaway account.
- Each sign-in is its own session, so signing in twice from the same browser adds a second, alike-named row under Devices; the rows differ by their sign-in time and "Last active".
- If the app shows "Please sign in again." or "We couldn't check your session", the session broke. Reopen the session rather than driving on; if it happens again, run the doctor and read `.agents/.state/stack.log`.
- Anything else on the sign-in page, like "Sign-in is temporarily unavailable" (503) or "Invalid sign-in origin." (400), is a stack or configuration failure. Run the doctor.
