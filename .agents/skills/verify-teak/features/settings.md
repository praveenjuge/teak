# Settings

Settings shows the account and its plan and usage, and holds the Security dialog (devices, connected apps and API keys), import and export, the theme, and sign-out. API keys are created here, shown once, and revoked here.

## Sub-features

- `settings-open` opens `/settings`, which shows the account email.
- `settings-theme` switches light, dark and system themes.
- `settings-devices` lists signed-in devices and can sign them out.
- `settings-api-key-create` creates a key, shown once, with "Copy".
- `settings-api-key-revoke` revokes one key, which stops working.
- `settings-api-key-regenerate` replaces a key with a new one.

## How to get to it (user POV)

- The sidebar link "Settings", or `/settings`.
- Settings → the Security row's button "Manage" → dialog "Security", with tabs "Connections" and "API keys".
- Command palette: "Toggle theme", "Import", "Export".

## Driving it with e2e MCP

Preconditions:

- Signed in ([sign-in](./sign-in.md)).
- No key named for this run exists. An account holds at most 10 active keys.

Steps:

- **Open.** `tap` link "Settings". Heading "Settings", link "Back", and the account email are shown.
- **Theme.** `tap` button "Use dark theme". It becomes pressed and the page turns dark (take a screenshot). `tap` "Use system theme" to restore. The theme lives only in this browser, so there's nothing to read back from the backend.
- **Devices.** `tap` the first button "Manage" (the Security row; the second is Import/Export). Dialog "Security" opens on tab "Connections". Region "Devices" lists an item marked "This device", with a button "Sign out <device> (this device)". Don't tap that one.
- **Create a key.** `tap` tab "API keys", then button "Create key". The status reads "API key created. Copy it now; it is only shown once.", a read-only textbox "New API key" and a button "Copy" appear, and the list gains `teakapi_secret_live_<prefix>_••••••••` with "Regenerate …" and "Revoke …" buttons. Don't read the textbox's value into notes, commands or screenshots you keep.
- **Regenerate.** `tap` "Regenerate teakapi_secret_live_<prefix>_••••••••, created <date>" for that key. The status reads "API key regenerated. Copy the new key now." and the "New API key" textbox shows a new key.
- **Revoke what you made.** Before leaving the dialog, `tap` the "Revoke teakapi_secret_live_<prefix>_••••••••, created <date>" button of every key this run created here (keys made in Settings show no name, only the prefix; `observe` the list for the current prefix after a regenerate). Each acts at once: the status reads "API key revoked." and the item disappears.
- **Prove a revoked key stops working.** Mint a key with `bun .agents/skills/verify-teak/scripts/api-key.ts mint`; it's listed here as "verify-teak", which also proves a key made through the API appears in Settings. `bun …/api-key.ts check` prints 200. `tap` "Revoke verify-teak, teakapi_secret_live_<prefix>_••••••••, created <date>". It acts at once, with no confirmation: the status reads "API key revoked." and the item disappears. `bun …/api-key.ts check` prints 401 within about 15 s; then `bun …/api-key.ts revoke` clears the saved file.

## Gotchas

- Revoke and "Revoke all keys" have no confirmation, and "Revoke all keys" also kills the key `scripts/api-key.ts` minted for other recipes. Run the API recipes first, or mint again afterwards.
- The full key is shown only once. Never copy it out of the page: agent safety checks (Claude Code's auto mode) block using a key read off the screen, and a key in notes or video leaks. Prove keys work with `scripts/api-key.ts`, which keeps the key inside its own process.
- Screenshots and video of the API keys tab right after "Create key" show the full key. Keep them out of PRs, or revoke the key first and say so.
- Keys made in Settings are all named "Default API key"; there's no name field.
- "Sign out <device> (this device)" in Devices ends this session.
- Key creation is rate-limited ("Too many API keys created. Try again in a minute.").
