# Sign in and sign out

A signed-out visitor to any app route is sent to Teak's hosted WorkOS sign-in page, signs in with email and password, and lands back in their library. Signing out from Settings or the command palette ends the session and returns to the hosted sign-in page.

## Sub-features

- `auth-redirect` sends an anonymous visit to `/sign-in?next=<path>`, which hands off to the hosted page.
- `auth-aliases` redirects `/login`, `/forgot-password` and `/reset-password` to `/sign-in`, and `/register` to `/sign-up`, keeping `next`.
- `auth-sign-in` signs in through the hosted email step, then the password step.
- `auth-return` lands on `next`, or `/` when there is none.
- `auth-sign-out-settings` signs out from the Settings page.
- `auth-sign-out-palette` signs out from the command palette.

## How to get to it (user POV)

- Open any app URL, such as `http://localhost:3000/` or `/settings`, while signed out.
- Open `/login` or `/sign-in` directly.
- Signed in: Settings → "Sign out".
- Signed in: Ctrl+K (⌘K on a Mac) → type "sign out" → Enter.

## Driving it with e2e MCP

Preconditions:

- The doctor passes. `open_session` starts signed out.
- The email and password are `account.email` and `account.password` in `.agents/.state/stack.json`.

Steps:

- **Redirect.** `open_session` opens `/`. The first observation's document is "Sign in" on the hosted WorkOS origin, with heading "Sign in" and textbox "Email". The URL is no longer `localhost`.
- **Email step.** `type` the email into textbox "Email", then `tap` button "Continue with email". The page changes to the password step: textbox "Email" shows the address, textbox "Password" is focused, and there's a link "Change email".
- **Password step.** `type` the password into textbox "Password", then `tap` button "Sign in". The app opens on `/`, with heading "Everything", sidebar links "Everything", "Favorites", "Tags", "Archive", "Trash" and "Settings", and the combobox "Search everything". Cards may show as the status "Loading cards" for up to a minute on a cold stack.
- **Deep link.** Signed out, `navigate` to `/settings`, then sign in. The app lands on `/settings` (heading "Settings"), not `/`.
- **Sign out from Settings.** `navigate` to `/settings`, wait for heading "Settings", `tap` button "Sign out". The hosted page with textbox "Email" appears. Proof: `navigate` to `/settings` again; it lands on the hosted page, not the app.
- **Sign out from the palette.** Signed in, with focus outside a text field, `press` "Control+k". Dialog "Command palette" opens with the combobox "Search commands, folders and cards". `type` "sign out", `press` "Enter". The hosted sign-in page appears.

## Gotchas

- The shared dev deployment uses real hosted WorkOS (staging), whose buttons are "Continue with email" and "Sign in". The local E2E stack uses the WorkOS emulator, whose buttons are both "Continue". Observe before you tap.
- The hosted page's Google, Microsoft, GitHub and Apple links leave the app. Never use them in a run.
- Accounts on the dev deployment are verified. An `example.org` address that WorkOS asks to verify can't receive the code, so a "Verify your email" step there means the account is wrong, not the app.
- Sign-out leaves the page at once, so its toasts vanish. Assert the hosted "Email" textbox, not a toast.
- "Sign out <device> (this device)" in Settings → Security also signs you out. Don't tap it during other recipes.
- If the app shows "Please sign in again." or "We couldn't check your session", the session broke. In a cloud session that usually means the browser isn't the image's Chromium (`.agents/cloud.md`). Reopen the session rather than driving on.
- Anything else on the sign-in page, like "Sign-in is temporarily unavailable" (503) or "Invalid sign-in origin." (400), is a stack or configuration failure. Run the doctor.
