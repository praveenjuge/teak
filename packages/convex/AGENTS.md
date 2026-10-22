<!-- convex-ai-start -->
Before editing this workspace, read `_generated/ai/guidelines.md` completely. Its generated Convex API and architecture rules override general guidance.
<!-- convex-ai-end -->

Schema changes require explicit approval for any migration or backfill. Define tables and indexes in `packages/convex/schema.ts` (field validators live in `schema/validators/`, re-exported from `schema.ts`) and scheduled jobs in `packages/convex/crons.ts`.
Tests: Bun unit tests go in `__tests__/` mirroring the source path (colocated `*.test.ts` files do not run). Database, auth, and component behavior uses `convex-test` in `edge/*.test.ts`; `vitest.config.ts` runs every file there, and each builds its module map with `import.meta.glob("../**/*.ts")`. Follow `.agents/testing.md`.
