---
name: teak-convex-backend
description: Change Teak's Convex backend in packages/convex the way the repository expects. Use for queries, mutations, actions, schema and index changes, the workflow dispatch outbox and RPC gateway, the public API and MCP server, and backend tests.
---

# Teak Convex backend

Before editing, read `packages/convex/_generated/ai/guidelines.md` and "Convex backend" under "Working in each workspace" in `apps/docs/content/docs/(open-source)/architecture.mdx`. For a new field, table, index, public API operation, backfill or workflow step, read `apps/docs/content/docs/(open-source)/adding-a-feature.mdx`. Load the vendored `convex` skills when the task needs them.

## Rules

- Schema changes need explicit approval for any migration or backfill; propose them, don't run them.
- Import backend APIs from `@teak/convex`, data types from `@teak/convex/_generated/dataModel`, shared constants from `@teak/convex/shared/constants`.
- A public API operation ships on the API, MCP, SDK and CLI together (`scripts/repo/public-parity.ts`).
- Card processing runs on the Core Worker's Workflows, started with `queueCardProcessing` (`packages/convex/workflowDispatch.ts`). Keep the processing-revision guard on every write the Worker makes through the workflow gateway.

## Prove the change

1. `bun run --cwd packages/convex test:unit` (Bun tests in `__tests__/`, mirroring the source path) and `test:edge` (`convex-test` files listed in `vitest.config.ts`), then `bun run --cwd packages/convex typecheck` and `lint`.
2. Backend behavior is only live on the dev deployment while this checkout holds the push lease: `bun run dev --stop && bun run dev --detach --push`, then `bun .agents/skills/verify-teak/scripts/doctor.ts` must show this checkout's backend before you verify. `bun run dev --local --detach` avoids the shared deployment for schema and destructive work.
3. Drive the affected feature through `.agents/skills/verify-teak` and keep the evidence.

Report what changed, the commands you ran with their results, and any step you could not reach.
