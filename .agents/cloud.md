# Teak in cloud sessions

What runs in a Claude Code on the web session (and similar Linux cloud VMs),
what doesn't, and the fixes for each. `apps/docs/content/docs/(open-source)/development.mdx` covers the
stack itself; this is the cloud-specific checklist. Last verified 2026-10-25
on a 4-vCPU, 16 GB VM (Chromium 153 in the image): sign-in and the seeded
vault on both stacks, file upload over CDP, `wrangler dev` with both
Containers, the Workflows engine tests, setup and the SessionStart hook; the
rest of "Works" was last driven on 2026-10-13.

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
  E2E suite's browsers land in the cached snapshot. On a fresh VM it takes
  about a minute and a half: the image's Chromium builds are linked in
  rather than downloaded again, so only WebKit downloads. It doesn't warm the
  Turbo cache (a cold typecheck takes about three minutes; cached, one
  second): the SessionStart hook runs `.agents/setup --warm` in the
  background at the lowest priority, once per VM (log in
  `.turbo/teak-warm.log`), so the session starts without waiting for it.
  Claude Code doesn't pass the
  environment's secrets to setup scripts, so its last step (connecting to the
  dev deployment) always skips there. The SessionStart hook does it instead
  with `.agents/setup --session` (about 15 seconds), and reinstalls packages
  whenever `bun.lock` has moved past the snapshot (it compares the hash in
  `node_modules/.teak-install`, the stamp `bun run doctor` checks).
- **Network:** the stack reaches hosts the default "Trusted" list doesn't
  have. Use "Full", or "Custom" with the default list plus: `*.convex.cloud`,
  `*.convex.site`, `api.workos.com`, `*.authkit.app`, `*.polar.sh`,
  `*.posthog.com`, `*.workers.dev`, `nodejs.org` and GitHub's release
  downloads (Node, Bun and the Convex local backend), Playwright's download
  hosts, `dl-cdn.alpinelinux.org` (Container builds), `fonts.gstatic.com`
  (docs), `www.raycast.com` (`ray lint`), and `docs.mcp.cloudflare.com` (the
  docs MCP server). The list comes from the code, not from a session on
  "Custom"; if a host is refused, the proxy names it. `bun run dev --local`
  needs none of the Convex, WorkOS, Polar or Workers hosts.
- **Turbo remote cache (optional):** the SessionStart hook warms the local
  Turbo cache in the background. To share one across sessions and CI, add `TURBO_TOKEN` and
  `TURBO_TEAM` for a Vercel Remote Cache to the environment's variables;
  Turbo reads them itself.
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

`bun run dev --local --detach` runs the app on a local backend instead: the
E2E suite's stack (a local Convex backend that pushes this checkout's
`packages/convex` as you edit it, the WorkOS emulator, and the Files Worker
in Miniflare), with a seeded `dev+local-<checkout>@example.org` account whose
new password `bun run dev --status` prints. It takes about 25 seconds, needs
no secrets and no shared backend, so schema and destructive work can't clash
with another session's push. What it leaves out is in `testing.mdx`, "What
the local stack doesn't cover". The emulator's sign-in buttons are both
"Continue". `bun run dev --stop`, then `bun run dev --detach`, goes back to
the dev deployment.

The first watch-mode `convex dev` downloads Convex's local dashboard, and that
download sometimes crashes the CLI behind the session's proxy (an assertion
in its HTTP parser). The local stack starts again by itself when that
happens, up to twice; the finished download is cached.

## Driving the app in a browser

Any Chromium loads the app now, the e2e MCP server's and Playwright's own
included. Until the image moved to Chromium 153 (October 2026), the proxy
intercepted newer Chromium's TLS and dropped the Convex WebSocket's upgrade,
so only the image's older Chromium could sign in; if "We couldn't check your
session" comes back after a sign-in, check that first with a bare
`new WebSocket("wss://reminiscent-kangaroo-59.convex.cloud/api/1.46.0/sync")`
in the page.

MCP servers start with the image's `PLAYWRIGHT_BROWSERS_PATH`
(`/opt/pw-browsers`), not the session's, so the SessionStart hook links the
E2E suite's pinned browsers into it; the e2e MCP server then finds them even
when the image ships another build.

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

Load `apps/extension/.output/chrome-mv3-dev` into Playwright's Chromium with
`launchPersistentContext(dir, { args: ["--disable-extensions-except=<dir>", "--load-extension=<dir>"] })`,
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
  image doesn't trust (`/root/.ccr/README.md`). The hook exports
  `WRANGLER_DOCKER_BIN=scripts/cloud-docker.sh`, a `docker` that adds that CA
  to every stage of the images `wrangler dev` builds (tagged
  `cloudflare-dev/…`) without changing the Dockerfile, so `wrangler dev`
  builds and runs both Containers. It leaves every other build alone, a
  `wrangler deploy` included, so a deploy from a cloud session still fails
  at the download step rather than shipping the proxy's CA. Build an image by
  hand with `scripts/cloud-docker-build.sh`, and never deploy what it builds:

  ```bash
  scripts/cloud-docker-build.sh teak-renderer apps/files-worker/container
  scripts/cloud-docker-build.sh teak-fetcher . apps/files-worker/fetcher/Dockerfile
  ```

  Then run the renderer's integration tests the way the `renderer` CI job
  does: start `teak-renderer` twice (`-p 18080:8080`, and `-p 18081:8080 -e
  RENDERER_TIMEOUT_SCALE=0.0001`, both `--cpus 0.25 --memory 1g`), and in
  `apps/files-worker` run `RENDERER_URL=http://localhost:18080
  RENDERER_TIMEOUT_URL=http://localhost:18081 bun test --timeout 60000
  container/test`.

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
  `config`). Against the E2E stack (and `bun run dev --local`) it runs e2e's
  pinned Chromium. While this checkout runs the dev stack, the config instead
  starts the image's Chromium with a DevTools port and attaches to it over
  CDP (`src/config/cloud-chromium.ts`), so a script can attach to the same
  browser for file uploads (below). That browser stays up for the MCP
  server's life and serves its later sessions.
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
  `setFiles`. Import's file input in Settings is real but hidden, and e2e
  0.19's `upload` can't reach it either (it needs a node id that `observe`
  never lists); set it the same way, with `setInputFiles` on
  `input[type=file][accept=".csv"]` (or the chosen source's extension).
- **Repository checks while the stack is up:** `turbo run typecheck lint
  test` beside the dev stack's Next.js compile pushed four `@teak/convex`
  HTTP tests past vitest's 5 s timeout on 4 vCPUs; they pass alone. Rerun a
  failing file in isolation before treating a timeout as a regression.
- **After `bun install` changes `next`:** the running dev server keeps the
  old build in memory and answers "Internal Server Error". Restart with
  `bun run dev --stop && bun run dev --detach`.

- **Cloudflare from a session:** the session has no Cloudflare credentials,
  so `bun run dev files` (remote bindings) and anything that deploys can't
  run; `bun run dev --local` and the E2E stack run the Worker without them.
  Two owner options, neither set up yet: connect Cloudflare's API MCP server
  (`https://mcp.cloudflare.com/mcp`) as a claude.ai connector, which signs in
  with OAuth and lets a session read `teak-files-dev`'s logs and
  observability without a token in the VM (the older "Workers Bindings"
  connector is deprecated); or, to give sessions a token at all, first move
  `teak-files-dev` to its own Cloudflare account, since an account-scoped
  token on today's account also reaches production.
- **Worker Previews** (generally available 2026-09-22) can give each branch
  its own Files Worker through Workers Builds with no token in the session,
  with its own Durable Objects and Containers. Not set up: previews share the
  dev Worker's Workflows, don't consume Queues, and Convex dev only talks to
  `teak-files-dev`, so a preview can't run card processing end to end yet.
  `preview_urls` stays `false` (version preview URLs don't support Durable
  Objects anyway).

## Doesn't work

- Browser sign-in for the CLI and Raycast (`teak login`, WorkOS Connect) from
  your own browser: the loopback callback can't reach the VM. Use an API key
  (`TEAK_API_KEY` with `TEAK_API_URL=https://reminiscent-kangaroo-59.convex.site`
  for the CLI).
- Apple, iPhone, iPad and Mac builds (no macOS or Xcode), and Android (no SDK
  and no `/dev/kvm` for an emulator).
- Work in progress across a reclaimed VM: background processes, including the
  dev stack, don't survive it. Run `bun run dev --detach` again each session.

## Keeping this page true

The image, the proxy and the CLIs change under this page (the Chromium
section above went stale within two weeks). To re-check it, start a fresh
session on `main` and work through it: run `bun run doctor`, `bun run dev
--detach` and sign in, `bun run dev --local --detach` and sign in,
`bun test src/workflows/cardProcessing/engine.test.ts` in
`apps/files-worker`, and `wrangler dev --local -c development/wrangler.jsonc`
there until both Containers build. Update "Last verified" and fix what
drifted in the same PR. A weekly scheduled task can run exactly that and open
the PR; the owner creates it, since it runs on their account.
