# Repository Guidelines

Refer to `CLAUDE.md` for more information.

## Project Structure & Module Organization

This Bun workspace monorepo is split into apps and packages. `apps/web` hosts the Next 15 frontend (React 19, Tailwind v4) and consumes shared utilities via the `@/` alias. `apps/mobile` contains the Expo Router client, `apps/extension` ships the WXT browser extension, and `apps/docs` renders the marketing/docs site. Convex backend logic lives in `packages/backend/convex`, with generated APIs in `_generated` (never edit manually) and re-exported through `packages/backend/index.ts`. Shared utilities live in `packages/shared/src`.

## Build, Test, and Development Commands

- `bun install` syncs all workspace dependencies and prepares Husky hooks.
- `bun run dev` launches the Convex dev server and web app together; use `bun run dev:backend` or `dev:frontend` to focus on one side.
- `bun run predev` waits for Convex migrations before starting other tasks.
- `bun run build` runs the production Next build for `apps/web`; mirror commands exist per workspace (`apps/docs`, `apps/extension`, `apps/mobile`).
- `bun run lint` enforces Next/ESLint rules; the pre-commit hook also runs `bunx tsc --noEmit` and `bun run build` to catch regressions early.
- Run `cd apps/extension && bun run dev` or `cd apps/mobile && bun run dev` for targeted work.

## Coding Style & Naming Conventions

Stick with TypeScript across workspaces, using strict mode and JSX with React Server Components. Let Prettier 3 defaults (2-space indent, semicolons on) format code, and rely on the provided flat ESLint configs (`next/core-web-vitals`, `eslint-config-expo`). Name React components with PascalCase, hooks with `use` prefixes, and co-locate UI primitives in `components/ui`. Use path aliases (`@/`, `@teak/shared`, `@teak/convex`) instead of relative ladders and prefer descriptive folder names that mirror domain concepts.

## Testing Guidelines

Automated tests are not yet wired up; type-checking (`bunx tsc --noEmit`) and successful builds are the enforced gates today. When adding coverage, prefer colocated `.test.ts(x)` files using the framework native to the workspace (e.g. Next Testing Library, Expo testing tools) and document any new commands in the relevant `package.json`. Exercise Convex functions through `bunx convex dev --until-success` before shipping backend changes.

## Commit & Pull Request Guidelines

Commits follow a conventional `type(scope?): summary` style (`feat:`, `fix(docs):`, etc.) as seen in git history—keep subjects in the imperative and under 72 characters. Run the Husky pre-commit locally if hooks are skipped, and avoid committing generated `_generated` artifacts. PRs should link issues, outline risky areas, and include screenshots or recordings for UI-affecting changes; mention configuration updates in the description.
