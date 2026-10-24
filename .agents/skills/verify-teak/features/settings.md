# Settings

Settings is a set of pages under `/settings`, listed in the nav "Settings pages" beside the content at 768 px and wider: **Account** (`/settings`), **Plan** (`/settings/plan`), **Appearance** (`/settings/appearance`), **Integrations** (`/settings/integrations`), **Security** (`/settings/security`) and **Import & export** (`/settings/data`). Account shows who is signed in with sign-out and a summary of every other page. Security ends with the delete-account section. API keys are created here (Integrations), shown once, and revoked here.

## Sub-features

- `settings-open` opens `/settings` (document title "Settings · Teak"): heading "Settings", the page heading "Account", the section "Signed in as" with the account's name and email as text, and the button "Sign out".
- `settings-overview` lists every other page in the nav "All settings", each a link with its summary: Plan "Free Plan · N of 200 cards", Appearance "System theme · English", Integrations "Save by email off · no API keys", Security "N devices signed in", Import & export "Bring cards in, or take them with you" (or "Export in progress", "Export ready to download", "Last export <date>").
- `settings-nav` moves between pages from the nav "Settings pages" (the current one has `aria-current="page"`), and from a page back to Account by the header breadcrumb link "Settings". At 390 px the nav is hidden; Account's list is the way in.
- `settings-shortcut` opens `/settings` with `G` then `S` from any page; the command palette's group "Settings" opens each page ("Settings: Plan" …).
- `settings-theme` switches system, light and dark from three previews on Appearance.
- `settings-devices` lists signed-in devices on Security with their sign-in date and time, and can sign them out after a confirmation.
- `settings-api-key-create` creates a key on Integrations, shown once, with "Copy".
- `settings-api-key-revoke` revokes one key after a confirmation, and the key stops working. Other new keys' one-time reveals stay.
- `settings-api-key-regenerate` replaces a key with a new one after a confirmation.
- `settings-plan` shows on Plan the progressbar "Cards used" ("N of 200 cards", "M cards left") and, on the free plan, the section "Upgrade to Pro" with "$19 / month" and "$99 / year" with the badge "Best Value • Save 57%", and "Continue to checkout". On Pro it shows "Manage subscription" instead.
- `settings-delete-account` asks for the phrase "delete account"; the field starts empty every time the dialog opens.
- `settings-legacy-link` sends an old `/settings?dialog=import` (or `export`) link to `/settings/data#import` (or `#export`).
- `not-found` shows "Page not found" with a link "Go to your cards" for any unknown URL, in the chosen theme.

## How to get to it (user POV)

- The sidebar link "Settings" (tooltip and hover hint `G S`), `G` then `S`, or `/settings`.
- The nav "Settings pages", or a link in Account's list "All settings".
- Settings → Security for devices and connected apps; Settings → Integrations for API keys.
- Settings → Plan, or any "Upgrade" in the app (the card-limit prompt, the extension popup), lands on `/settings/plan`.
- Settings → Security → the section "Delete account" → button "Delete your account" → dialog "Delete account".
- Any unknown URL, such as `/does-not-exist-xyz`.
- Command palette: "Settings", "Settings: <page>", "Toggle theme", "Import", "Export".

## Driving it with e2e MCP

Preconditions:

- Signed in ([sign-in](./sign-in.md)).
- No key named for this run exists. An account holds at most 10 active keys.

Steps:

- **Open.** `tap` link "Settings". Heading "Settings", the section "Signed in as" with the account email, and the button "Sign out" are shown, and the nav "All settings" lists "Plan", "Appearance", "Integrations", "Security" and "Import & export" with their summaries (a summary is a pulsing bar until its data loads).
- **Navigate.** In the nav "Settings pages", `tap` "Appearance": heading "Appearance" (level 2), the link is `aria-current="page"`, and the header reads "Settings › Appearance". `tap` the header link "Settings": back on `/settings`. `press` `g` then `s` from `/`: `/settings` opens.
- **Theme.** On Appearance, `tap` button "Use dark theme". It becomes pressed, its preview gets the ring, and the page turns dark (take a screenshot). `tap` "Use system theme" to restore. The theme lives only in this browser, so there's nothing to read back from the backend. Account's Appearance summary follows ("Dark theme · English").
- **Devices.** `navigate` to `/settings/security`. Region "Devices" lists an item marked "This device", with a button "Sign out <device> (this device)"; each item reads "Signed in <date>, <time>". `tap` another device's "Sign out <device>": alert dialog "Sign out <device>?" names its sign-in time, with "Cancel" and "Sign out". `tap` "Cancel"; the device stays listed. Never confirm on the shared account. Region "Connected apps" is below it, then the section "Delete account".
- **Create a key.** `navigate` to `/settings/integrations`. In region "API keys" (its description says "Up to 10 keys." and links to the API docs), `tap` button "Create key" beside the title. The status reads "API key created. Copy it now; it is only shown once.", a read-only textbox "New API key" and a button "Copy" appear, and the list gains `teakapi_secret_live_<prefix>_••••••••` with "Regenerate …" and "Revoke …" buttons. Don't read the textbox's value into notes, commands or screenshots you keep.
- **Regenerate.** `tap` "Regenerate teakapi_secret_live_<prefix>_••••••••, created <date>" for that key. Alert dialog "Regenerate this API key?" opens; `tap` its "Regenerate key". The status reads "API key regenerated. Copy the new key now." and a "New API key" textbox shows the new key in place of the old one's.
- **Revoke keeps other reveals.** `tap` "Create key" twice: two "New API key" textboxes show, newest first. `tap` "Revoke …" for the older key: alert dialog "Revoke this API key?" opens, and Escape or "Cancel" closes it with the key still listed and focus back on that "Revoke …" button. `tap` it again, then the dialog's "Revoke key". The status reads "API key revoked.", the item disappears, and the newer key's textbox is still shown.
- **Revoke all asks first.** `tap` "Revoke all keys": alert dialog "Revoke all API keys?" opens. `tap` "Cancel". Never confirm it on the shared account (it kills every key, including other runs').
- **Revoke what you made.** Before leaving the page, revoke every key this run created here: "Revoke teakapi_secret_live_<prefix>_••••••••, created <date>", then "Revoke key" in the confirmation (keys made in Settings show no name, only the prefix; `observe` the list for the current prefix after a regenerate). The status reads "API key revoked." and the item disappears.
- **Prove a revoked key stops working.** Mint a key with `bun .agents/skills/verify-teak/scripts/api-key.ts mint`; it's listed on Integrations as "verify-teak", which also proves a key made through the API appears in Settings. `bun …/api-key.ts check` prints 200. `tap` "Revoke verify-teak, teakapi_secret_live_<prefix>_••••••••, created <date>", then "Revoke key" in the confirmation: the status reads "API key revoked." and the item disappears. `bun …/api-key.ts check` prints 401 within about 15 s; then `bun …/api-key.ts revoke` clears the saved file.
- **Plan.** `navigate` to `/settings/plan`. The progressbar "Cards used" reads "N of 200 cards" with "M cards left" (N matches Account's card count). The section "Upgrade to Pro" shows "$19 / month", "$99 / year" (selected) and "Best Value • Save 57%", the feature "iOS, Mac & Android Apps", and the button "Continue to checkout". Don't continue to checkout.
- **Delete account (don't).** On `/settings/security`, `tap` "Delete your account". `type` "delete acc" into textbox "Type "delete account" to proceed", `press` "Escape", and open it again: the textbox is empty and "Delete account" is disabled. `press` "Escape"; focus is back on "Delete your account".
- **Old links.** `navigate` to `/settings?dialog=export`: the URL becomes `/settings/data#export` and region "Export" is shown.
- **Not found.** `navigate` to `/does-not-exist-xyz`. Heading "Page not found" and link "Go to your cards" (to `/`) show, on the theme's background (also with "Use dark theme" pressed while the system is light). The document title is "Page not found · Teak".

## Gotchas

- Revoke, regenerate, "Revoke all keys", device "Sign out" and app "Disconnect" each open an alert dialog first; the action runs only on its confirm button. "Revoke all keys" also kills the key `scripts/api-key.ts` minted for other recipes. Run the API recipes first, or mint again afterwards.
- The key list updates before the revoke or regenerate call returns. Wait for the status text ("API key revoked.", "API key regenerated. …") before reading the "New API key" textboxes.
- The full key is shown only once. Never copy it out of the page: agent safety checks (Claude Code's auto mode) block using a key read off the screen, and a key in notes or video leaks. Prove keys work with `scripts/api-key.ts`, which keeps the key inside its own process.
- Screenshots and video of Integrations right after "Create key" show the full key. Keep them out of PRs, or revoke the key first and say so.
- Keys made in Settings are all named "Default API key"; there's no name field.
- "Sign out <device> (this device)" in Devices ends this session.
- Key creation is rate-limited ("Too many API keys created. Try again in a minute.").
