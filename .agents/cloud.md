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
- **`NODE_OPTIONS`:** set it to `--max-old-space-size=8192 --use-openssl-ca`
  in the environment's variables. The image sets only the heap flag. The
  session's HTTPS proxy re-signs traffic, and Turbo's strict env mode drops
  `NODE_EXTRA_CA_CERTS` from the tasks it runs, so without `--use-openssl-ca`
  Node tools under Turbo fail with "self-signed certificate in certificate
  chain". That fails `bun run lint` (Raycast's `ray lint` calls raycast.com),
  the pre-commit hook when Raycast is affected, and the docs site's Google
  Fonts fetch.

## Works

`bun run dev` is ready in about 30 seconds. It works against the shared dev
deployment for all of these:

- sign-in and sign-out through the WorkOS hosted page
- the seeded vault, the composer (text, links, quotes, palettes), uploads and
  previews (image, PDF, text, audio, WebM video)
- audio recording (launch Chromium with `--use-fake-ui-for-media-stream
  --use-fake-device-for-media-stream`)
- AI summaries, tags and transcripts, and link metadata
- search and filters, the card modal, favorites, notes and tags, trash and
  restore, the context menu and bulk actions
- theme and devices in Settings, API keys, and bookmark import
- the REST API, MCP and the CLI with `--api-key`

Also `bun run smoke:web`, `bun run test`, `typecheck`, the extension, CLI and
Raycast builds, and the docs site. `lint` works once `NODE_OPTIONS` is set.

Only the agent can see the app. It runs on the VM's `localhost`, and cloud
sessions have no port forwarding, so drive it with headless Chromium
(Playwright) and send screenshots.

## Needs care

- **One shared account:** every cloud VM is machine `vm` with checkout
  `main`, so every cloud session signs in as `dev+vm-main@example.org` and
  shares its vault and limits. Expect cards left by earlier sessions, mark what
  you create with a unique string, and delete it afterwards (the REST API's
  `DELETE /v1/cards/{id}?permanent=true` takes an API key). Revoke API keys you
  create. Exports are limited to one per account every 7 days, so an earlier
  session may already have used it.
- **E2E suite:** run the Chromium projects with one worker. Four workers
  starve the local backend on a 4-vCPU VM, and queries hit Convex's 1 s limit.
  Firefox and WebKit aren't installed. The run below takes about 14 minutes.

  ```bash
  bun run dev --stop
  bun run --cwd packages/tests e2e "--project=journey-*" --project=matrix-chromium --project=web --workers=1
  bun run dev   # selects the dev deployment again
  ```

  The exported `CONVEX_DEPLOY_KEY` can stay: the suite drops it, and every
  Convex CLI it runs uses the local backend. In full runs on this VM,
  `journey-web-core`'s first test has failed every time on a `beforeunload`
  dialog: it navigates while a save is still in flight. It passes when the
  project runs alone (`--project=journey-web-core`), so rerun it that way
  before treating it as a regression.

- **`playwright` MCP server:** it looks for Google Chrome, which the image
  doesn't have. Use Playwright from `node_modules` with the browsers the
  SessionStart hook points `PLAYWRIGHT_BROWSERS_PATH` at, or launch
  `/opt/pw-browsers/chromium` directly.
- **MP4 video:** Playwright's Chromium has no H.264 decoder, so MP4 cards
  don't play in it. Use a WebM (VP9) file to check video playback.

## Doesn't work

- Polar sandbox checkout for the seeded accounts: Polar rejects the
  `@example.org` address because that domain doesn't accept email. The UI shows
  "Failed to start checkout".
- Browser sign-in for the CLI, extension and Raycast (`teak login`, WorkOS
  Connect): the loopback callback can't reach the VM. Use an API key.
- Apple, iPhone, iPad and Mac builds (no macOS or Xcode), and Android (no SDK
  and no `/dev/kvm` for an emulator).
- Work in progress across a reclaimed VM: background processes, including the
  dev stack, don't survive it. Start the stack again each session.
