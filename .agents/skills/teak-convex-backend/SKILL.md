---
name: teak-convex-backend
description: Change Teak's Convex backend in packages/convex the way the repository expects. Use for queries, mutations, actions, schema and index changes, the workflow dispatch outbox and RPC gateway, the public API and MCP server, and backend tests.
---

# Teak Convex backend

Before editing, read `packages/convex/_generated/ai/guidelines.md` and "Convex backend" in `apps/docs/content/docs/(open-source)/architecture.mdx`; for a new field, table, index, public API operation, backfill or workflow step, also `apps/docs/content/docs/(open-source)/adding-a-feature.mdx`. Load the vendored `convex` skills as needed.

## Rules

- Propose any migration or backfill a schema change needs; run it only with explicit approval.
- Import backend APIs from `@teak/convex`, data types from `@teak/convex/_generated/dataModel`, shared constants from `@teak/convex/shared/constants`.
- A public API operation ships on the API, MCP, SDK and CLI together (`scripts/repo/public-parity.ts`).
- Card processing runs on the Core Worker's Workflows, started with `queueCardProcessing` (`packages/convex/card/processingRuns.ts`) through the dispatch outbox (`workflowDispatch/outbox.ts`; each kind's spec sits beside its domain, listed in `workflowDispatch.ts`). Delete objects only through `queueObjectDeletion` (`storage/objectDeletion.ts`). Keep the processing-revision guard on every Worker write through the workflow gateway.

## Prove the change

1. `bun run --cwd packages/convex test:unit` (Bun tests in `__tests__/`, mirroring the source path) and `test:edge` (`convex-test` files listed in `vitest.config.ts`), then `bun run --cwd packages/convex typecheck` and `lint`.
2. Your backend is live on the dev deployment only while this checkout holds the push lease: `bun run dev --stop && bun run dev --detach --push`, then `bun .agents/skills/verify-teak/scripts/doctor.ts` must show this checkout's backend. For schema or destructive work use `bun run dev --local --detach`.
3. Drive the affected feature through `.agents/skills/verify-teak` and keep the evidence.

Report what changed, the commands run with results, and any step you couldn't reach.
