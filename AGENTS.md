# Teak agent guide

Teak is a personal knowledge hub for collecting, remembering, and rediscovering ideas and inspiration.

## Start here

- Use Bun. Read the pinned version and available commands from `package.json`; do not duplicate that inventory here.
- Read the nearest nested `AGENTS.md` before changing a workspace.
- On a fresh checkout, run `bun run setup` once, then diagnose with `bun run doctor` before asking the human. `bun run dev [target]` starts the watch loop; never bind production credentials locally.
- Environment sources, precedence, and ownership live in `docs/agents/environment.md`.
- Inspect the current implementation and tests before choosing a pattern. Treat repository code and configuration as the source of truth.
- Keep changes focused. Preserve unrelated work already in the tree.

## Architecture invariants

- This is a Turborepo monorepo. Applications live in `apps/*`; shared backend and UI code live in `packages/convex` and `packages/ui`.
- Client reads use the cached Convex query hooks. Writes use Convex mutations or actions. Better Auth sessions provide Convex identity.
- Import backend APIs from `@teak/convex`, generated data types from `@teak/convex/_generated/dataModel`, and shared constants from `@teak/convex/shared/constants`.
- Shared web, desktop, and extension UI belongs in `packages/ui` unless the behavior is surface-specific.
- Card processing is orchestrated by `packages/convex/workflows/cardProcessing.ts`. Preserve workflow retries and `processingStatus` consistency.
- Supported card types are text, link, image, video, audio, document, palette, and quote.

## Convex work

Read `packages/convex/AGENTS.md` before editing backend code.

## Verification

- Add or update deterministic tests for changed behavior. Run the narrowest relevant checks first, then the repository checks warranted by the change.
- Test user-observable behavior rather than implementation details.
- Cross-surface production journeys belong in `packages/tests`; read `packages/tests/README.md` before changing or running them.
- Never bypass git hooks with `--no-verify`. Fix the failing check.
- Verify user-facing work in the real interface when practical. A passing build alone is not proof of the experience.

## Documentation contract

Keep user documentation synchronized per `apps/docs/AGENTS.md`.

## Release pointers

Before any release, complete the shared preparation in `docs/agents/releases.md`. Then read the relevant product runbook and follow it exactly:

- Mobile: `apps/mobile/release.md`
- Desktop: `apps/desktop/RELEASE.md`
- Browser extension: `apps/extension/release.md`
- Safari extension: `apps/safari-extension/release.md`
- CLI: `apps/cli/AGENTS.md`

All package versions move in lockstep. Release tasks use the next patch version unless the canonical runbook says otherwise. Use `gh` for GitHub releases, pull requests, issues, and workflow inspection.

## Headless development

When working in Cursor Cloud or another headless VM, read `docs/agents/headless-development.md`. Local development should use the scripts and environment already present in the repository.
