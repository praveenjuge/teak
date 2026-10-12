# Teak in cloud sessions

What runs in a Claude Code on the web session (and similar Linux cloud VMs),
what doesn't, and the fixes for each. `.agents/development.md` covers the
stack itself; this is the cloud-specific checklist. Last verified 2026-10-12
on a 4-vCPU, 16 GB VM, by driving every web feature in headless Chromium and
running the API, CLI, MCP, repository checks and E2E suite.

## Environment settings

- **Secrets:** only `CONVEX_DEPLOY_KEY` (a dev deploy key). Don't export
  `CONVEX_DEPLOYMENT`, `WORKOS_*` or `NEXT_PUBLIC_*`: shell exports win over the
  dotenv files `bun run dev` writes (`.agents/environment.md`). A stale
  `WORKOS_COOKIE_PASSWORD` makes the server reject the sessions
  `bun run smoke:web` seals, and the E2E suite refuses to start while
  `CONVEX_DEPLOYMENT` names the dev deployment. The SessionStart hook warns
  when any of them are set; until they're removed, prefix commands with
  `env -u NAME …`.
- **Setup script:** `bash .agents/setup`, so the toolchain, packages and the
  E2E suite's Chromium land in the cached snapshot.
- **Network:** the stack needs Convex, WorkOS and Polar (and Playwright's CDN
  for setup), which aren't on the default "Trusted" list. Use "Full", or add
  them under "Custom".
- **`NODE_OPTIONS`:** nothing to set. The SessionStart hook adds
  `--use-openssl-ca` to the session's `NODE_OPTIONS`, so Node trusts the HTTPS
  proxy through the system store. Turbo's strict env mode drops
  `NODE_EXTRA_CA_CERTS`, so without the flag Node tasks under Turbo fail with
  "self-signed certificate in certificate chain": Raycast's `ray lint` on
  raycast.com (which also fails the pre-commit hook when Raycast is affected)
  and the docs dev server's Google Fonts fetch. If you set it by hand earlier,
  you can remove it.

## One account per session

Every cloud VM is named `vm` and checks out `main`, so `bun run dev` names a
Claude Code session's account after a hash of `CLAUDE_CODE_REMOTE_SESSION_ID`
instead: `dev+cloud-<hash>-main@example.org`. Each session starts with a fresh
seeded vault, its own export allowance and its own device list. Resuming a
session on a new VM signs in to the same account with a new password.
Other cloud agents (Codex, Amp) still use `dev+<hostname>-main@example.org`.

Finished sessions' accounts are pruned. Once its own account is ready,
`bun run dev` in a Claude Code session looks in the background for other
`dev+cloud-<hash>-<checkout>@example.org` accounts that nobody has signed in to
(or, never used, that were created) more than 14 days ago, and deletes each
through the backend's account deletion workflow (`devSeed:pruneCloudAccount`),
which removes its cards, files and WorkOS user. The backend refuses unless
`TEAK_DEV_DEPLOYMENT=true` and refuses every other address, and the current
session's account is never a candidate. `.agents/.state/stack.log` says which
accounts were pruned, or why pruning was skipped. Resuming a session after two
weeks away starts again with a fresh seeded vault.

## Starting the stack

Run `bun run dev --detach`. It starts the stack in its own session, waits until
the app is ready (about 50 seconds cold, 10 seconds warm) and returns. Don't
start plain `bun run dev` as a background command: Claude Code stops
background commands after 30 minutes, and the stack goes with it.

## Driving the app in a browser

Launch Playwright with the image's Chromium, which the SessionStart hook
exports as `TEAK_CLOUD_CHROMIUM`:

```js
chromium.launch({ executablePath: process.env.TEAK_CLOUD_CHROMIUM })
```

The pinned Playwright's own Chromium (151) can't open the Convex WebSocket
through the session's HTTPS proxy. Convex answers the handshake with
`400 InvalidConnectionHeader` ("Connection header did not include upgrade")
even though Chromium sends a correct HTTP/1.1 upgrade, so after sign-in the
app shows a spinner and then "We couldn't check your session". The image's
Chromium 141 in `/opt/pw-browsers`, curl and Node's `ws` all upgrade fine
through the same proxy. `--proxy-server`, `--disable-http2` and
`--disable-features=WebSocketOverHttp2` don't help. The E2E suite is
unaffected: its stack is on `localhost`, which bypasses the proxy.

## Works

It works against the shared dev deployment for all of these:

- sign-in and sign-out through the WorkOS hosted page
- the seeded vault, the composer (text, links, quotes, palettes), uploads and
  previews (image, PDF, text, audio, WebM video)
- audio recording (launch Chromium with `--use-fake-ui-for-media-stream
  --use-fake-device-for-media-stream`)
- AI summaries, tags and transcripts, and link metadata
- search and filters, the card modal, favorites, notes and tags, trash and
  restore, the context menu and bulk actions
- theme and devices in Settings, API keys, and import and export
- the REST API, MCP and the CLI with `--api-key`
- "Upgrade to Pro": Polar's sandbox checkout opens in a new tab, for the
  seeded accounts too (`.agents/development.md`)

Also `bun run smoke:web`, `bun run test`, `typecheck`, `lint`, the CLI and
Raycast builds, the web production build and the docs site.

The browser extension works too, including sign-in, because the VM's own
browser completes the WorkOS flow:

```bash
bun run setup --target extension   # .agents/setup already does this
(cd apps/extension && bunx wxt build --mode development)
```

Load `apps/extension/.output/chrome-mv3-dev` into `TEAK_CLOUD_CHROMIUM` with
`launchPersistentContext(dir, { executablePath, args: ["--disable-extensions-except=<dir>", "--load-extension=<dir>"] })`,
open `chrome-extension://<id>/popup.html` and sign in through the AuthKit
window it opens. A production build (`bun run build:extension`) signs in
against production, so don't use it here.

Only the agent can see the app. It runs on the VM's `localhost`, and cloud
sessions have no port forwarding, so drive it with headless Chromium (the
`e2e` MCP server's sessions) and send screenshots.

## Needs care

- **E2E suite:** run it with the dev stack stopped. `.agents/setup` installs
  the Chromium and WebKit builds the e2e web engine pins. The Chromium suite
  runs one browser at a time: on a 4-vCPU VM a second one starves the local
  backend, and its functions hit Convex's 1 s limit.

  ```bash
  bun run dev --stop
  bun run --cwd packages/tests e2e
  bun run dev --detach   # selects the dev deployment again
  ```

  The exported `CONVEX_DEPLOY_KEY` can stay: the suite drops it, and every
  Convex CLI it runs uses the local backend. If a run reports a missing
  browser, install it with `env -u PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD bun
  --cwd=packages/tests x e2e-web install chromium webkit`.

- **`e2e` MCP server:** `.mcp.json` registers `e2e mcp`, which opens headless
  sessions with the e2e engine's pinned Chromium. That works against the E2E
  stack, which is all local. Against the dev deployment, the pinned Chromium
  likely hits the proxy WebSocket problem above, so drive the dev stack with
  Playwright from `node_modules` and
  `executablePath: process.env.TEAK_CLOUD_CHROMIUM` instead.
- **MP4 video:** Playwright's Chromium has no H.264 decoder, so MP4 cards
  don't play in it. Use a WebM (VP9) file to check video playback.

## Doesn't work

- Browser sign-in for the CLI and Raycast (`teak login`, WorkOS Connect) from
  your own browser: the loopback callback can't reach the VM. Use an API key
  (`TEAK_API_KEY` with `TEAK_API_URL=https://reminiscent-kangaroo-59.convex.site`
  for the CLI).
- Apple, iPhone, iPad and Mac builds (no macOS or Xcode), and Android (no SDK
  and no `/dev/kvm` for an emulator).
- Work in progress across a reclaimed VM: background processes, including the
  dev stack, don't survive it. Run `bun run dev --detach` again each session.
