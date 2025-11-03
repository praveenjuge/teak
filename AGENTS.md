# Repository Guidelines

Review `CLAUDE.md` for deep architecture notes and file inventories.

## Project Structure & Module Organization

- Workspace apps live under `apps/`: Next.js web (`web`), Expo mobile (`mobile`), browser extension (`extension`), and docs (`docs`). Convex lives under `backend/`.
- Backend logic belongs in `backend/convex` and re-exports through `backend/index.ts`; avoid touching `_generated`.
- Shared types, helpers, and constants stay in `backend/shared` and load via `@teak/convex/shared`.
- Workflow orchestration for cards lives in `backend/convex/workflows` (classification → categorization → metadata → renderables) and is consumed via `internal.workflows.*` references.
- Use the `@/` alias for `apps/web`, keep docs content in `apps/docs/content`, and store extension assets beneath `apps/extension/assets`.
- Co-locate tests beside sources as `.test.ts`/`.test.tsx` files and prefer domain folders such as `cards/` or `search/`.
- Everything in `backend/convex/_generated` is auto-generated; avoid manual edits.

## Build, Test, and Development Commands

- `bun install` installs workspace dependencies and initializes Husky hooks.
- `bun run dev` launches Next 15 and Convex locally; switch to `bun run dev:frontend`, `dev:backend`, `dev:mobile`, or `dev:extension` for focused loops.
- `bun run predev` waits for Convex migrations; run it after schema edits or environment changes.
- `bun run build`, `bun run build:extension`, and `bun run package:extension` generate production binaries.
- `bun run lint` and `bunx tsc --noEmit` mirror pre-commit checks and should be clean before committing.

## Coding Style & Naming Conventions

Write TypeScript in strict mode and embrace React Server Components on web routes. Follow Prettier 3 defaults (2-space indent, semicolons) and the flat ESLint config in `package.json`. Use PascalCase for components, camelCase for utilities, prefix hooks with `use`, and import internals via `@/`, `@teak/convex`, or `@teak/convex/shared` instead of deep relative paths.

## Testing Guidelines

Run `bunx tsc --noEmit` and `bun run build` to spot regressions early. Use Next Testing Library for web UI, Expo tooling for mobile surfaces, and the WXT harness for extension scripts. After modifying backend schema or mutations, confirm migrations with `bunx convex dev --until-success`.

## Commit & Pull Request Guidelines

Use Conventional Commits (for example, `feat(cards): add pinning`, `fix(docs): update hero`) with imperative summaries under 72 characters. Exclude `_generated` artifacts. Pull requests should link relevant issues, flag risky migrations or config updates, and attach screenshots or recordings for UI-visible changes.

## Security & Configuration Tips

Keep secrets in workspace-specific `.env.local` files. Load required Clerk and Convex credentials via `bun run predev`, update `backend/convex/convex.config.ts` whenever adding env keys, and document expectations in `README.md`. Harden Convex mutations with server-side validation and least-privilege access.
