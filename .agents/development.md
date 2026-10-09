# Running Teak locally

One command starts a working, seeded app in any checkout, worktree, or cloud VM:

```bash
bun run dev
```

It runs setup (packages, a local Convex backend, env files), then starts the
local WorkOS emulator, the backend, and the web app, creates a dev account with
sample cards, and prints the URLs and sign-in. It needs no secrets. Agents should run it in
the background; it stays up until stopped.

| Command | What it does |
| --- | --- |
| `bun run dev` | Set up and start this checkout's stack |
| `bun run dev --status` | Ports, URLs, sign-in, and whether the stack is running |
| `bun run dev --stop` | Stop this checkout's stack |
| `bun run dev --workos staging` | Sign in through WorkOS staging instead of the emulator |
| `bun run dev <target>` | Another surface (`mobile`, `extension`, `docs`, …) through Turbo |
| `bun run smoke:web` | Headless sign-in check against the running stack |
| `bun run --cwd packages/tests e2e` | The E2E suite on this checkout's stack |

## Signing in

The emulator's sign-in page lists its accounts. Use `dev@example.org` with the
password `teak-dev-Password-1!` (test-only, in
`packages/tests/src/stack/config.ts`). Its vault is seeded once with about 30
text, link, quote, and palette cards (`packages/convex/devSeed.ts`); empty the
vault to seed it again on the next start. For a session without a browser, use
`scripts/lib/workos-test-session.ts`, as `bun run smoke:web` does.

## Worktrees

Every linked worktree leases its own block of ports the first time it runs,
recorded in the repository's git directory (`scripts/worktree-env.ts`), so
stacks in different worktrees run side by side. The main checkout keeps web
3000, docs 3001, Convex 3210/3211, and the emulator 4100. Each worktree's local
backend keeps its data in its own `packages/convex/.convex/`, which goes away
with the worktree. `bun run dev --status` prints the ports.

A running stack writes `.agents/.state/stack.json` (URLs, ports, pid) and logs
to `.agents/.state/stack.log`.

## What the local stack doesn't cover

File uploads, previews, AI metadata, imports and exports need the Files Worker
and Cloudflare, which the local stack doesn't run. WorkOS Connect (CLI,
extensions, Mac app, Raycast, MCP OAuth), AuthKit Actions, and billing need
WorkOS staging or other credentials: use `bun run dev --workos staging` with
`WORKOS_CLIENT_ID` and `WORKOS_API_KEY` exported from a staging environment
(never production).

A checkout that already uses a cloud deployment or WorkOS staging keeps using
it; setup never overwrites a value a person set and says how to switch.

## Cloud agents

`.agents/setup` prepares a fresh Linux VM: the pinned Node and Bun, packages,
and the local backend. It needs no secrets but does need network access to
npm, GitHub (the Bun download) and Convex (the local backend binary).

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
