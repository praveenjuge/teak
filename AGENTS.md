# Teak agent guide

Teak is a personal knowledge hub for collecting, remembering, and rediscovering ideas and inspiration.

## Start here

- Use Bun. Read the pinned version and available commands from `package.json`; do not duplicate that inventory here.
- Read the nearest nested `AGENTS.md` before changing a workspace.
- To run the app, run `bun run dev --detach` (it returns once the app is ready and keeps running in the background). It sets up this checkout and starts the web app on this worktree's own port against the shared cloud dev deployment, signed in through WorkOS staging as a seeded account. It needs a Convex login on a Mac or `CONVEX_DEPLOY_KEY` (a dev deploy key) in a cloud session. `bun run dev --status` prints the URLs and sign-in; `bun run dev --stop` stops it. Read `.agents/development.md` for the push lease, worktrees and cloud VMs. Never bind production credentials locally.
- Environment sources, precedence, and ownership live in `.agents/environment.md`; read it before adding env vars or debugging config.
- Product analytics and error reporting (PostHog) live in `.agents/analytics.md`; read it before adding an event or touching telemetry.
- `.agents/README.md` lists every guide, plan and skill in `.agents`. Plans in `.agents/plans` are for unshipped work; delete a plan in the PR that finishes it.
- Inspect the current implementation and tests before choosing a pattern. Treat repository code and configuration as the source of truth.
- Keep changes focused. Preserve unrelated work already in the tree.

## Architecture invariants

- This is a Turborepo monorepo. Applications live in `apps/*`. Packages:
  - `packages/convex`: the backend, plus the pure helpers in `shared/` that other surfaces import.
  - `packages/files-protocol`: the contract between Convex and the Files Worker.
  - `packages/sdk`: the public `teak-sdk` client. The CLI, extension, docs and e2e tests use it from source.
  - `packages/tests`: the end-to-end suite.
- Client reads use the cached Convex query hooks. Writes use Convex mutations or actions. WorkOS AuthKit sessions provide Convex identity; WorkOS is the only sign-in provider in every environment.
- Import backend APIs from `@teak/convex`, generated data types from `@teak/convex/_generated/dataModel`, and shared constants from `@teak/convex/shared/constants`.
- The web app owns its UI in `apps/web/src`; read its `AGENTS.md` for where each kind of file goes. The browser extension keeps its own small copies of the button, wordmark and theme tokens. Pure helpers that several surfaces share (web, docs, extension, native ports) go in `packages/convex/shared`.
- Card processing is orchestrated by the Files Worker's Cloudflare Workflow (`apps/files-worker/src/workflows/cardProcessing/run.ts`), started from Convex with `queueCardProcessing` (`packages/convex/workflowDispatch.ts`). Preserve workflow retries, the processing-revision guard on every write, and `processingStatus` consistency.
- Supported card types are text, link, image, video, audio, document, palette, and quote.
- `teakvault.com/api`, `/mcp` and the OAuth discovery documents reach Convex only through the Files Worker's edge proxy (`apps/files-worker/src/edge/apiProxy.ts`), which also rate-limits them. The docs site on Vercel has no rewrites for them.

## Convex work

Read `packages/convex/AGENTS.md` before editing backend code.

Read `.agents/feature-conventions.md` before adding a field, table, index, public API operation, backfill or workflow step. It covers shipping a feature on the API, MCP, SDK and CLI together (`scripts/public-parity.ts`), search sync, account deletion coverage, index replacement and deploy order.

## Verification

- Read `.agents/testing.md` before adding, changing, or deleting tests. It covers where tests go, which layer to use, and what makes a test worth keeping.
Every change ends with proof, every time. These rules are not optional and not "when practical":

- **Prove it works.** Before you call any task done, follow `.agents/skills/principle-prove-it-works/SKILL.md`: check the real artifact (run the feature, read the stored value, inspect the diff), not a proxy. A passing build, typecheck or test run alone is not proof.
- **Verify in the running app.** For any change a user can observe (web, API, CLI, MCP, or backend behavior behind them), follow `.agents/skills/verify-teak/SKILL.md`: launch, run its doctor, drive every feature the change touches through the recipes in its `features/`, keep the evidence, clean up. A bug fix reproduces the bug first. Put the evidence in the PR's Proof section, and say in Verification which features you drove and anything you could not reach.
- **Map what you build.** A change that adds or changes a user-facing feature adds or updates its file in `.agents/skills/verify-teak/features/` in the same PR, and drives the new recipe once. `scripts/verify-feature-map.test.ts` checks the map's shape.
- `create-verification-skill` and `maintain-verification-skill` in `.agents/skills` (vendored from pstack) built that map and audit it; run the second when recipes drift from the app. They are written for Cursor: in Teak a generated or maintained verification skill lives in `.agents/skills/verify-<app>/`, never `.cursor/skills/`.

- Add or update deterministic tests for changed behavior. Run the narrowest relevant checks first, then the repository checks warranted by the change.
- Test user-observable behavior rather than implementation details.
- End-to-end tests (web, API, CLI, MCP) belong in `packages/tests` and run against a local stack with the WorkOS emulator; read `packages/tests/README.md` before changing or running them.
- Never bypass git hooks with `--no-verify`. Fix the failing check.
- The `e2e` MCP server in `.mcp.json` drives a real browser against the local app; run the `packages/tests` specs with `bunx e2e run` (the e2e skill in `.agents/skills/e2e/` covers both, but never run its `e2e feedback`; see `.agents/testing.md`).

## Pull requests

Read `.agents/pull-requests.md` before opening a PR or posting on GitHub. It covers the PR template, what must never appear in a public PR, and how to attach screenshots and video.

## Documentation contract

For user documentation or changelog changes, follow `apps/docs/AGENTS.md`.

## Release pointers

Before any release, complete the shared preparation in `.agents/releases.md` (one next-patch version change across every manifest, confirmed by the lockstep validator). Then read the relevant product runbook and follow it exactly:

- Apple (iPhone, iPad, Mac): `apps/apple/release.md`
- Android: `apps/android/release.md`
- Browser extension: `apps/extension/release.md`
- CLI: `apps/cli/AGENTS.md`
- Store screenshots (iPhone, iPad, Mac, Play): `scripts/store-assets/README.md`

All package versions move in lockstep. Release tasks use the next patch version unless the canonical runbook says otherwise. Use `gh` for GitHub releases, pull requests, issues, and workflow inspection.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
