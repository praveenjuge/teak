# Settings

Settings shows the account and its plan and usage, and holds the Security dialog (devices, connected apps and API keys), import and export, the theme, and sign-out. API keys are created here, shown once, and revoked here.

## Sub-features

- `settings-open` opens `/settings` (document title "Settings · Teak"), which shows the account email and card count as text.
- `settings-theme` switches light, dark and system themes.
- `settings-devices` lists signed-in devices with their sign-in date and time, and can sign them out after a confirmation.
- `settings-api-key-create` creates a key, shown once, with "Copy".
- `settings-api-key-revoke` revokes one key after a confirmation, and the key stops working. Other new keys' one-time reveals stay.
- `settings-api-key-regenerate` replaces a key with a new one after a confirmation.
- `settings-upgrade` shows the Pro plans: "$19 / month" and "$99 / year" with the badge "Best Value • Save 57%".
- `settings-delete-account` asks for the phrase "delete account"; the field starts empty every time the dialog opens.
- `not-found` shows "Page not found" with a link "Go to your cards" for any unknown URL, in the chosen theme.

## How to get to it (user POV)

- The sidebar link "Settings", or `/settings`.
- Settings → the Security row's button "Manage security" (visible text "Manage") → dialog "Security", with tabs "Connections" and "API keys".
- Settings → the Plan row's button "Upgrade" → dialog "Upgrade to Pro".
- Settings → the footer's button "delete your account" → dialog "Delete account".
- Any unknown URL, such as `/does-not-exist-xyz`.
- Command palette: "Toggle theme", "Import", "Export".

## Driving it with e2e MCP

Preconditions:

- Signed in ([sign-in](./sign-in.md)).
- No key named for this run exists. An account holds at most 10 active keys.

Steps:

- **Open.** `tap` link "Settings". Heading "Settings", link "Back", and the account email are shown.
- **Theme.** `tap` button "Use dark theme". It becomes pressed and the page turns dark (take a screenshot). `tap` "Use system theme" to restore. The theme lives only in this browser, so there's nothing to read back from the backend.
- **Devices.** `tap` button "Manage security" (the Import/Export row's is "Manage import and export"). Dialog "Security" opens on tab "Connections". Region "Devices" lists an item marked "This device", with a button "Sign out <device> (this device)"; each item reads "Signed in <date>, <time>". `tap` another device's "Sign out <device>": alert dialog "Sign out <device>?" names its sign-in time, with "Cancel" and "Sign out". `tap` "Cancel"; the device stays listed. Never confirm on the shared account.
- **Create a key.** `tap` tab "API keys", then button "Create key". The status reads "API key created. Copy it now; it is only shown once.", a read-only textbox "New API key" and a button "Copy" appear, and the list gains `teakapi_secret_live_<prefix>_••••••••` with "Regenerate …" and "Revoke …" buttons. Don't read the textbox's value into notes, commands or screenshots you keep.
- **Regenerate.** `tap` "Regenerate teakapi_secret_live_<prefix>_••••••••, created <date>" for that key. Alert dialog "Regenerate this API key?" opens; `tap` its "Regenerate key". The status reads "API key regenerated. Copy the new key now." and a "New API key" textbox shows the new key in place of the old one's.
- **Revoke keeps other reveals.** `tap` "Create key" twice: two "New API key" textboxes show, newest first. `tap` "Revoke …" for the older key: alert dialog "Revoke this API key?" opens, and Escape or "Cancel" closes it with the key still listed and focus back on that "Revoke …" button. `tap` it again, then the dialog's "Revoke key". The status reads "API key revoked.", the item disappears, and the newer key's textbox is still shown.
- **Revoke all asks first.** `tap` "Revoke all keys": alert dialog "Revoke all API keys?" opens. `tap` "Cancel". Never confirm it on the shared account (it kills every key, including other runs').
- **Revoke what you made.** Before leaving the dialog, revoke every key this run created here: "Revoke teakapi_secret_live_<prefix>_••••••••, created <date>", then "Revoke key" in the confirmation (keys made in Settings show no name, only the prefix; `observe` the list for the current prefix after a regenerate). The status reads "API key revoked." and the item disappears.
- **Prove a revoked key stops working.** Mint a key with `bun .agents/skills/verify-teak/scripts/api-key.ts mint`; it's listed here as "verify-teak", which also proves a key made through the API appears in Settings. `bun …/api-key.ts check` prints 200. `tap` "Revoke verify-teak, teakapi_secret_live_<prefix>_••••••••, created <date>", then "Revoke key" in the confirmation: the status reads "API key revoked." and the item disappears. `bun …/api-key.ts check` prints 401 within about 15 s; then `bun …/api-key.ts revoke` clears the saved file.
- **Upgrade.** `tap` "Upgrade". Dialog "Upgrade to Pro" shows "$19 / month", "$99 / year" and "Best Value • Save 57%", and the feature "iOS, Mac & Android Apps". `press` "Escape": focus is back on "Upgrade". Don't continue to checkout.
- **Delete account (don't).** `tap` "delete your account". `type` "delete acc" into textbox "Type "delete account" to proceed", `press` "Escape", and open it again: the textbox is empty and "Delete account" is disabled. `press` "Escape"; focus is back on "delete your account".
- **Not found.** `navigate` to `/does-not-exist-xyz`. Heading "Page not found" and link "Go to your cards" (to `/`) show, on the theme's background (also with "Use dark theme" pressed while the system is light). The document title is "Page not found · Teak".

## Gotchas

- Revoke, regenerate, "Revoke all keys", device "Sign out" and app "Disconnect" each open an alert dialog first; the action runs only on its confirm button. "Revoke all keys" also kills the key `scripts/api-key.ts` minted for other recipes. Run the API recipes first, or mint again afterwards.
- The key list updates before the revoke or regenerate call returns. Wait for the status text ("API key revoked.", "API key regenerated. …") before reading the "New API key" textboxes.
- The full key is shown only once. Never copy it out of the page: agent safety checks (Claude Code's auto mode) block using a key read off the screen, and a key in notes or video leaks. Prove keys work with `scripts/api-key.ts`, which keeps the key inside its own process.
- Screenshots and video of the API keys tab right after "Create key" show the full key. Keep them out of PRs, or revoke the key first and say so.
- Keys made in Settings are all named "Default API key"; there's no name field.
- "Sign out <device> (this device)" in Devices ends this session.
- Key creation is rate-limited ("Too many API keys created. Try again in a minute.").
