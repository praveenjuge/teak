# Teak in cloud sessions

What runs in a Claude Code on the web session (and similar Linux cloud VMs),
what doesn't, and the fixes for each. `.agents/development.md` covers the
stack itself; this is the cloud-specific checklist. Last verified 2026-10-11.

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
- **`NODE_OPTIONS=--use-openssl-ca`:** makes Node trust the session's HTTPS
  proxy for tools that ignore `NODE_EXTRA_CA_CERTS`. Without it Raycast's
  `ray lint` fails on raycast.com ("self-signed certificate in certificate
  chain"), which also fails the pre-commit hook when Raycast is affected.

## Works

`bun run dev` against the shared dev deployment, with sign-in, seeded vault,
composer, search and filters, card modal, trash and restore, bulk actions,
uploads and previews, audio recording, AI summaries and tags, link metadata,
import and export, API keys, the REST API, MCP, and the CLI with `--api-key`.
Also `bun run smoke:web`, `bun run test`, `typecheck`, `lint`, the docs site,
and the extension build.

Only the agent can see the app: it runs on the VM's `localhost`, so drive it
with headless Chromium (Playwright), not your own browser.

## Needs care

- **E2E suite:** run the Chromium projects with one worker. Four workers
  starve the local backend on a 4-vCPU VM, and queries hit Convex's 1 s limit.
  Firefox and WebKit aren't installed.

  ```bash
  bun run dev --stop
  bun run --cwd packages/tests e2e "--project=journey-*" --project=matrix-chromium --project=web --workers=1
  bun run dev   # selects the dev deployment again
  ```

- **`playwright` MCP server:** it looks for Google Chrome, which the image
  doesn't have. Use Playwright from `node_modules` with the browsers the
  SessionStart hook points `PLAYWRIGHT_BROWSERS_PATH` at, or launch
  `/opt/pw-browsers/chromium` directly.

## Doesn't work

- Browser sign-in for the CLI, extension and Raycast (`teak login`, WorkOS
  Connect): the loopback callback can't reach the VM. Use an API key.
- Apple, iPhone, iPad and Mac builds (no macOS or Xcode), and Android (no SDK
  and no `/dev/kvm` for an emulator).
- Work in progress across a reclaimed VM: background processes, including the
  dev stack, don't survive it. Start the stack again each session.
