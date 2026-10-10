# Running Teak locally

One command starts the full app in any checkout, worktree, or cloud VM:

```bash
bun run dev
```

It runs setup (packages, env files), then starts this checkout's web app
against the **shared cloud dev deployment** (`dev:reminiscent-kangaroo-59`),
signed in through WorkOS staging. Files, previews, AI metadata, screenshots,
imports and exports, WorkOS Connect, and Polar sandbox billing all work, the
same as on the dev deployment itself. Agents should run it in the background;
it stays up until stopped.

| Command | What it does |
| --- | --- |
| `bun run dev` | Set up and start this checkout's web app |
| `bun run dev --push` | Same, and take over pushing the backend (see below) |
| `bun run dev --status` | Ports, URLs, sign-in, and whether this checkout pushes |
| `bun run dev --stop` | Stop this checkout's stack |
| `bun run dev <target>` | Another surface (`mobile`, `extension`, `docs`, …) through Turbo |
| `bun run smoke:web` | Headless sign-in check against the running web app |
| `bun run --cwd packages/tests e2e` | The E2E suite, on its own local stack |

## Reaching the dev deployment

- **Mac checkouts** (the main checkout and every worktree) use your Convex
  login: run `bunx convex login` once. Setup selects the dev deployment in
  `packages/convex/.env.local`.
- **Cloud sessions** (Claude Code on the web, Codex, Amp) have no login. Their
  environment's secrets hold `CONVEX_DEPLOY_KEY`, a dev deploy key scoped to
  the dev deployment. It is the only secret a cloud environment needs.

Setup and doctor refuse every other key or selection (production, preview,
project and admin keys, other deployments), so dev never touches production.
The WorkOS staging client ID and API key the web app needs are read from the
dev deployment into `apps/web/.env.local`; nobody exports them by hand.

## One backend, one pusher

Every checkout shares the deployment's code and data, so only one checkout at a
time runs `convex dev`. It holds the **push lease**, stored in the deployment
(`packages/convex/devPushLease.ts`) and renewed every 30 seconds.

- `bun run dev` takes the lease when it is free. Otherwise it runs the web app
  only, against whatever backend code is live, and says which branch pushed it.
- `bun run dev --push` takes the lease over. The previous holder stops pushing
  at its next heartbeat and says why.
- A holder that stops (Ctrl-C, crash, closed laptop) frees the lease within two
  minutes.

Backend changes on a branch are live for every checkout while that branch
holds the lease, so push a branch's backend only while you work on it.

## Signing in

Each checkout gets its own WorkOS staging account,
`dev+<machine>-<checkout>@example.org`, with a random password kept in the
ignored `.agents/.state/dev-account.json`. Its vault is seeded once with about
30 sample cards (`packages/convex/devSeed.ts`). `bun run dev --status` prints
the email and password. For a session without a browser, use
`scripts/lib/workos-test-session.ts`, as `bun run smoke:web` does.

## Worktrees

Every linked worktree leases its own block of ports the first time it runs,
recorded in the repository's git directory (`scripts/worktree-env.ts`), so web
apps in different worktrees run side by side. The main checkout keeps web 3000,
docs 3001 and extension 3003. `bun run dev --status` prints the ports.
`packages/convex/convex.json` registers every one of those web ports as a
sign-in callback on the dev deployment's WorkOS environment.

A running stack writes `.agents/.state/stack.json` (URLs, ports, sign-in) and
logs to `.agents/.state/stack.log`.

The dev deployment's `appUrl` links point at port 3000, so links from a
worktree's API responses open the main checkout's web app.

## The E2E suite

The E2E suite never touches the dev deployment. It runs its own stack: a local
Convex backend and the local WorkOS emulator, with test-only values and no
secrets (`packages/tests/README.md`). While it runs it takes over
`packages/convex/.env.local`; the next `bun run dev` selects the dev deployment
again. Stop the dev stack before running it.

## Owner one-time setup

The repository owner does these once; nobody else needs to:

1. On the dev deployment (`bunx convex env set NAME value` in `packages/convex`,
   or the Convex dashboard):
   - `TEAK_DEV_DEPLOYMENT=true` turns on seeding and the push lease.
   - `TEAK_DEV_APP_URL=http://localhost:3000`
   - `TEAK_DEV_DOCS_URL=http://localhost:3001`
   - `TEAK_DEV_API_URL=https://reminiscent-kangaroo-59.convex.site`
2. For cloud sessions, create a dev deploy key for the dev deployment
   (`bunx convex deployment token create cloud-agents --deployment dev`, or the
   deployment's settings in the dashboard) and add it to each cloud
   environment's secrets as `CONVEX_DEPLOY_KEY`. The key has full access to the
   dev deployment, including its variables (the shared Files and WorkOS staging
   credentials), so keep it out of untrusted environments.

`bun run doctor` warns about any of the first group that are missing; until
they are set, `bun run dev` still runs the web app but doesn't seed or push.

## Cloud agents

`.agents/setup` prepares a fresh Linux VM: the pinned Node and Bun, packages,
and, when `CONVEX_DEPLOY_KEY` is present, the wiring to the dev deployment.
Without the key it still prepares the VM for unit tests and the E2E suite.

- Claude Code on the web: set the environment's setup script to
  `bash .agents/setup` so the result is cached. The SessionStart hook in
  `.claude/settings.json` also runs it when a VM isn't ready, and prints
  `bun run dev --status` at the start of every session.
- Codex cloud: set the environment's setup script to `bash .agents/setup`.
- Amp: runs `.agents/setup` as the orb setup script and `.agents/resume` on
  resume.

Then run `bun run dev` in the background.

## When something fails

`bun run dev` prints the failing setup check and how to fix it. For more, run
`bun run doctor --json`. Environment sources and ownership are in
`.agents/environment.md`.
