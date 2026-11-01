---
name: teak-core-worker
description: Change or debug Teak's Cloudflare Core Worker in apps/core-worker. Use for Save by email, Workflows, Queues, Durable Objects, Containers, R2, KV, Workers AI, Vectorize, the API/MCP edge proxy, either Wrangler config, or a card-processing, import, export or deletion run.
---

# Teak Core Worker

Before changing anything, read the sections of `apps/core-worker/README.md` the task touches and "Rules every change keeps" in `apps/docs/content/docs/(open-source)/architecture.mdx`. Load the `wrangler`, `workers-best-practices` and `durable-objects` skills when the task needs them, and read current Cloudflare docs instead of relying on memory.

## Invariants

- Workflow step names are durable history: never rename one, and add new steps after the existing ones.
- Every card-processing write carries the run's processing revision (`guardOf(job)`); a stale write ends the run as skipped and never overwrites newer work. Keep `processingStatus` consistent and every run reporting back through `workflowDispatch.complete`.
- A `NonRetryableError` thrown inside a step reaches the workflow as a plain `Error` whose message starts with `NonRetryableError: `. Code that matches on a step error's message must allow for that prefix.
- Development binds only development resources (`apps/core-worker/development/wrangler.jsonc`); never point it at production buckets, indexes, routes or secrets.
- After changing a Wrangler config, run `bun run cf-typegen` in `apps/core-worker`; never hand-edit `worker-configuration.d.ts`.

## Prove the change, cheapest first

1. `bun test <file>` in `apps/core-worker`, then `bun run test` and `bun run typecheck` there, and `bun run cf-typegen:check`.
2. When the behavior depends on the real Workflows engine (retries, errors crossing a step, completion reports), add a case to `src/workflows/cardProcessing/engine.test.ts` (Wrangler's `createTestHarness`, no account needed).
3. For user-visible behavior, follow `.agents/skills/verify-teak/features/card-processing.md`: run the local end-to-end stack and read the run's steps, logs and stored objects through Local Explorer.

Report what changed, the commands you ran with their results, and anything you could not reach (for example Containers without a running Docker daemon, or remote bindings without a Cloudflare token).
