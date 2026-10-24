# Teak in cloud sessions

What runs in a Claude Code on the web session (and similar Linux cloud VMs),
what doesn't, and the fixes for each. `apps/docs/content/docs/(open-source)/development.mdx` covers the
stack itself; this is the cloud-specific checklist. Last verified 2026-10-13
on a 4-vCPU, 16 GB VM, by driving every web feature in headless Chromium and
running the API, CLI, MCP and repository checks.

## Environment settings

- **Secrets:** only `CONVEX_DEPLOY_KEY` (a dev deploy key). Don't export
  `CONVEX_DEPLOYMENT`, `WORKOS_*` or `NEXT_PUBLIC_*`: shell exports win over the
  dotenv files `bun run dev` writes (`development.mdx`, "Environment and configuration"). A stale
  `WORKOS_COOKIE_PASSWORD` makes the server reject the sessions
  `bun run smoke:web` seals, and the E2E suite refuses to start while
  `CONVEX_DEPLOYMENT` names the dev deployment. The SessionStart hook warns
  when any of them are set; until they're removed, prefix commands with
  `env -u NAME …`.
- **Files Workers:** using and deploying them needs no Cloudflare token.
  Workers Builds deploys both Files Workers from `main` (`teak-files-prod`
  and `teak-files-dev`), and the dev deployment's Convex env already points
  at `teak-files-dev`. Running one locally is different: `bun run dev files`
  needs `bun run sync:cloudflare-dev --isolated` first and Cloudflare
  credentials for its remote bindings, so a session without a Cloudflare
  token can't run it. The local E2E stack runs the Worker without them
  (Workflows, Queues, R2 and KV in Miniflare), and Docker runs the two
  Containers (see "Containers" below).
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

The pinned Playwright's own Chromium (151, and e2e's 153) can't open the
Convex WebSocket through the session's HTTPS proxy. The proxy intercepts
newer Chromium's TLS with its own certificate, and its interception path
doesn't carry WebSocket upgrades (`/root/.ccr/README.md` lists them as
unsupported): Convex answers the handshake with `400 InvalidConnectionHeader`
("Connection header did not include upgrade") even though Chromium sends a
correct HTTP/1.1 upgrade, so after sign-in the app shows a spinner and then
"We couldn't check your session". The proxy passes the image's Chromium 141
in `/opt/pw-browsers` through to Convex untouched (it sees Convex's own
certificate), and curl and Node's `ws` upgrade fine too. `--proxy-server`,
`--disable-http2`, `--disable-features=WebSocketOverHttp2` and turning off
Encrypted Client Hello don't help. The E2E suite is unaffected: its stack is
on `localhost`, which bypasses the proxy.

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
  seeded accounts too (`development.mdx`, "Signing in")

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

- **Containers:** the image ships Docker without running it, so the
  SessionStart hook starts the daemon (`.agents/hooks/start-docker.sh`; its
  log is `/tmp/teak-dockerd.log`). Pulling and running images works, but a
  build step that downloads (`apk add`, `bun install`) fails with
  "certificate not trusted": the session's proxy re-signs TLS with a CA the
  image doesn't trust (`/root/.ccr/README.md`). Build with
  `scripts/cloud-docker-build.sh`, which adds that CA to every stage without
  changing the Dockerfile, and never deploy what it builds:

  ```bash
  scripts/cloud-docker-build.sh teak-renderer apps/files-worker/container
  scripts/cloud-docker-build.sh teak-fetcher . apps/files-worker/fetcher/Dockerfile
  ```

  Then run the renderer's integration tests the way the `renderer` CI job
  does: start `teak-renderer` twice (`-p 18080:8080`, and `-p 18081:8080 -e
  RENDERER_TIMEOUT_SCALE=0.0001`, both `--cpus 0.25 --memory 1g`), and in
  `apps/files-worker` run `RENDERER_URL=http://localhost:18080
  RENDERER_TIMEOUT_URL=http://localhost:18081 bun test --timeout 60000
  container/test`. `wrangler dev` builds images with plain `docker build`, so
  it still fails at the download step here.

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
  sessions on `packages/tests/e2e.config.ts` (pass that as `open_session`'s
  `config`). Against the E2E stack it runs e2e's pinned Chromium. While this
  checkout runs the dev stack, the config instead starts the image's
  Chromium and attaches to it over CDP (`src/config/cloud-chromium.ts`), so
  the Convex socket gets through the proxy and the seeded vault loads. That
  browser stays up for the MCP server's life and serves its later sessions.
- **MP4 video:** Playwright's Chromium has no H.264 decoder, so MP4 cards
  don't play in it. Use a WebM (VP9) file to check video playback.
- **The backend you test against is whatever was pushed last.** Every
  checkout shares the dev deployment's code. If another branch's push left
  documents that this checkout's schema rejects, `convex dev` logs "Schema
  validation failed" in `.agents/.state/stack.log` and never pushes: the web
  app then runs this branch's frontend against the other branch's backend.
  Check with `bunx convex run devPushLease:status` in `packages/convex`
  (`lastPush.label` names the branch and commit that is live) and read the
  log before trusting a backend result. A field another branch wrote is the
  usual cause: merge that branch, carry the same optional field on yours, or
  delete the offending documents in the Convex dashboard.
- **File uploads from the `e2e` MCP server:** the "Upload files" button
  creates its file input on the fly, so e2e's `upload` tool finds no input
  node, and it refuses files outside `packages/tests` or under a dotted
  directory. Drive the chooser over CDP instead: read the port from
  `/tmp/teak-cloud-chromium-*/DevToolsActivePort`, `chromium.connectOverCDP`
  with the repo's `playwright-core`, wait for `page.on("filechooser")` and
  `setFiles`. Import's inputs in Settings are real and work with `upload`.
- **Repository checks while the stack is up:** `turbo run typecheck lint
  test` beside the dev stack's Next.js compile pushed four `@teak/convex`
  HTTP tests past vitest's 5 s timeout on 4 vCPUs; they pass alone. Rerun a
  failing file in isolation before treating a timeout as a regression.
- **After `bun install` changes `next`:** the running dev server keeps the
  old build in memory and answers "Internal Server Error". Restart with
  `bun run dev --stop && bun run dev --detach`.

## Doesn't work

- Browser sign-in for the CLI and Raycast (`teak login`, WorkOS Connect) from
  your own browser: the loopback callback can't reach the VM. Use an API key
  (`TEAK_API_KEY` with `TEAK_API_URL=https://reminiscent-kangaroo-59.convex.site`
  for the CLI).
- Apple, iPhone, iPad and Mac builds (no macOS or Xcode), and Android (no SDK
  and no `/dev/kvm` for an emulator).
- Work in progress across a reclaimed VM: background processes, including the
  dev stack, don't survive it. Run `bun run dev --detach` again each session.
