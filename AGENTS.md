# Teak agent guide

Teak is a personal knowledge hub for collecting, remembering, and rediscovering ideas and inspiration.

## Start here

The public docs in `apps/docs/content/docs` are the source for how Teak is built, run and tested. Read the page for your task from this checkout (not teakvault.com), so you read your branch's version. Sections marked `<Visibility for="agents">` are written for you.

| Before you | Read |
| --- | --- |
| run the app, push backend code, or work in a worktree or cloud VM | `apps/docs/content/docs/(open-source)/development.mdx` |
| change how apps, the backend and the Workers connect | `apps/docs/content/docs/(open-source)/architecture.mdx` |
| add, change or delete a test, or run the end-to-end suite | `apps/docs/content/docs/(open-source)/testing.mdx` |
| add a field, table, index, public API operation, backfill or workflow step | `apps/docs/content/docs/(open-source)/adding-a-feature.mdx` |
| add or change text people read in the web app or extension | `apps/docs/content/docs/(open-source)/translating.mdx` |
| touch deployment config, Worker bindings or secrets | `apps/docs/content/docs/(open-source)/self-hosting.mdx`, then `.agents/environment.md` for Teak's own deployments |

- Before your first change in a session, read "Rules every change keeps" in `architecture.mdx`: they hold for every change, whatever its size.
- Use Bun. Read the pinned version and available commands from `package.json`; do not duplicate that inventory here.
- Read the nearest nested `AGENTS.md` before changing a workspace.
- Run the app with `bun run dev --detach`; `bun run dev --status` prints the URLs and sign-in, and `bun run dev --stop` stops it. Never bind production credentials locally.
- Product analytics and error reporting (PostHog) live in `.agents/analytics.md`; read it before adding an event or touching telemetry.
- New English text goes into all seven other catalogs in the same PR.
- `.agents/README.md` lists every guide, plan and skill in `.agents`. Plans in `.agents/plans` are for unshipped work; delete a plan in the PR that finishes it.
- Inspect the current implementation and tests before choosing a pattern. Treat repository code and configuration as the source of truth.
- Keep changes focused. Preserve unrelated work already in the tree.

## Convex work

Read `packages/convex/AGENTS.md` before editing backend code, and `adding-a-feature.mdx` (above) before changing the schema or the public API.

## Verification

Every change ends with proof, every time. These rules are not optional and not "when practical":

- **Prove it works.** Before you call any task done, follow `.agents/skills/principle-prove-it-works/SKILL.md`: check the real artifact (run the feature, read the stored value, inspect the diff), not a proxy. A passing build, typecheck or test run alone is not proof.
- **Verify in the running app.** For any change a user can observe (web, API, CLI, MCP, or backend behavior behind them), follow `.agents/skills/verify-teak/SKILL.md`: launch, run its doctor, drive every feature the change touches through the recipes in its `features/`, keep the evidence, clean up. A bug fix reproduces the bug first. Put the evidence in the PR's Proof section, and say in Verification which features you drove and anything you could not reach.
- **Map what you build.** A change that adds or changes a user-facing feature adds or updates its file in `.agents/skills/verify-teak/features/` in the same PR, and drives the new recipe once. `scripts/verify-feature-map.test.ts` checks the map's shape.
- `create-verification-skill` and `maintain-verification-skill` in `.agents/skills` (vendored from pstack) built that map and audit it; run the second when recipes drift from the app. They are written for Cursor: in Teak a generated or maintained verification skill lives in `.agents/skills/verify-<app>/`, never `.cursor/skills/`.

- Add or update deterministic tests for changed behavior. Run the narrowest relevant checks first, then the repository checks warranted by the change.
- Test user-observable behavior rather than implementation details.
- End-to-end tests (web, API, CLI, MCP) belong in `packages/tests` and run against a local stack with the WorkOS emulator (`testing.mdx`, "End-to-end suite").
- Never bypass git hooks with `--no-verify`. Fix the failing check.
- The `e2e` MCP server in `.mcp.json` drives a real browser against the local app; run the `packages/tests` specs with `bunx e2e run` (the e2e skill in `.agents/skills/e2e/` covers both, but never run its `e2e feedback`; see `testing.mdx`).

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
