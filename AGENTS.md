# Repository Guidelines

See `CLAUDE.md` for expanded architecture notes and file maps.

## Project Structure & Module Organization

- Bun workspace surfaces live in `apps/` (`web`, `mobile`, `extension`, `docs`); cross-cutting packages stay under `packages/`.
- Keep Convex logic in `packages/backend/convex`, re-export via `packages/backend/index.ts`, and never touch `_generated`.
- Shared utilities, constants, and TypeScript types now live in `packages/backend/shared`; consume them via the `@teak/convex/shared` entrypoints.
- The `@/` alias resolves to `apps/web`; docs content sits in `apps/docs/content`, and extension assets in `apps/extension/assets`.

## Build, Test, and Development Commands

- `bun install` installs all workspace deps and prepares Husky hooks.
- `bun run dev` boots both Next 15 and Convex; use `bun run dev:frontend`, `dev:backend`, `dev:mobile`, or `dev:extension` for scoped loops.
- `bun run predev` blocks until Convex migrations settle; call it when schema churns.
- `bun run build`, `bun run build:extension`, and `bun run package:extension` create production artifacts.
- `bun run lint` and `bunx tsc --noEmit` mirror the pre-commit checks; run them locally before opening a PR.

## Coding Style & Naming Conventions

Author TypeScript in strict mode with React Server Components on the web. Follow Prettier 3 defaults (2-space indent, semicolons) and the flat ESLint configs declared in `package.json`. Use PascalCase for components, camelCase for utilities, `use` prefixes for hooks, and domain folders such as `cards/` or `search/`. Import internals via `@/`, `@teak/convex`, and `@teak/convex/shared` instead of relative ladders, and co-locate reusable UI under `components/ui`.

## Testing Guidelines

Automated coverage is light today; rely on `bunx tsc --noEmit` and `bun run build` to catch regressions. Place `.test.ts(x)` files beside the source, use Next Testing Library on web, Expo tooling on mobile, and wxt harnesses for the extension. Run `bunx convex dev --until-success` after schema or backend updates to confirm migrations.

## Commit & Pull Request Guidelines

Commits follow Conventional Commits (`feat(cards): add pinning`, `fix(docs): update hero`). Keep summaries imperative and under 72 chars, and avoid committing `_generated` artifacts. PRs should link issues, summarize risky areas, and include screenshots or recordings for UI changes while calling out configuration or schema updates explicitly.

## Security & Configuration Tips

Store secrets in `.env.local` files per workspace and keep them out of version control. Load Clerk and Convex credentials via `bun run predev`, update `packages/backend/convex/convex.config.ts` when adding env keys, and document required values in `README.md`. Apply least privilege to Convex mutations and favor server-side validation in `packages/backend/convex/*`.
