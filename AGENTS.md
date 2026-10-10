# Teak agent guide

Teak is a personal knowledge hub for collecting, remembering, and rediscovering ideas and inspiration.

## Start here

- Use Bun. Read the pinned version and available commands from `package.json`; do not duplicate that inventory here.
- Read the nearest nested `AGENTS.md` before changing a workspace.
- To run the app, start `bun run dev` in the background. It sets up this checkout and starts the web app on this worktree's own port against the shared cloud dev deployment, signed in through WorkOS staging as a seeded account. It needs a Convex login on a Mac or `CONVEX_DEPLOY_KEY` (a dev deploy key) in a cloud session. `bun run dev --status` prints the URLs and sign-in; `bun run dev --stop` stops it. Read `.agents/development.md` for the push lease, worktrees and cloud VMs. Never bind production credentials locally.
- Environment sources, precedence, and ownership live in `.agents/environment.md`; read it before adding env vars or debugging config.
- Inspect the current implementation and tests before choosing a pattern. Treat repository code and configuration as the source of truth.
- Keep changes focused. Preserve unrelated work already in the tree.

## Architecture invariants

- This is a Turborepo monorepo. Applications live in `apps/*`; shared backend and UI code live in `packages/convex` and `packages/ui`.
- Client reads use the cached Convex query hooks. Writes use Convex mutations or actions. WorkOS AuthKit sessions provide Convex identity; WorkOS is the only sign-in provider in every environment.
- Import backend APIs from `@teak/convex`, generated data types from `@teak/convex/_generated/dataModel`, and shared constants from `@teak/convex/shared/constants`.
- Shared web and extension UI belongs in `packages/ui` unless the behavior is surface-specific.
- Card processing is orchestrated by `packages/convex/workflows/cardProcessing.ts`. Preserve workflow retries and `processingStatus` consistency.
- Supported card types are text, link, image, video, audio, document, palette, and quote.

## Convex work

Read `packages/convex/AGENTS.md` before editing backend code.

## Verification

- Read `.agents/testing.md` before adding, changing, or deleting tests. It covers where tests go, which layer to use, and what makes a test worth keeping.
- Add or update deterministic tests for changed behavior. Run the narrowest relevant checks first, then the repository checks warranted by the change.
- Test user-observable behavior rather than implementation details.
- End-to-end tests (web, API, CLI, MCP) belong in `packages/tests` and run against a local stack with the WorkOS emulator; read `packages/tests/README.md` before changing or running them.
- Never bypass git hooks with `--no-verify`. Fix the failing check.
- Verify user-facing work in the real interface when practical. A passing build alone is not proof of the experience.
- The `playwright` MCP server in `.mcp.json` drives a real browser against the local app, and `playwright-test` runs the `packages/tests` specs.

## Documentation contract

For user documentation or changelog changes, follow `apps/docs/AGENTS.md`.

## Release pointers

Before any release, complete the shared preparation in `.agents/releases.md` (one next-patch version change across every manifest, confirmed by the lockstep validator). Then read the relevant product runbook and follow it exactly:

- Mobile: `apps/mobile/release.md`
- Android: `apps/android/release.md`
- Browser extension: `apps/extension/release.md`
- Mac: `apps/mac/release.md`
- CLI: `apps/cli/AGENTS.md`

All package versions move in lockstep. Release tasks use the next patch version unless the canonical runbook says otherwise. Use `gh` for GitHub releases, pull requests, issues, and workflow inspection.
