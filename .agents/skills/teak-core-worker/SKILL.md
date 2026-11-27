---
name: teak-core-worker
description: Change or debug Teak's Cloudflare Core Worker in apps/core-worker. Use for Save by email, Workflows, Queues, Durable Objects, Containers, R2, KV, Workers AI, Vectorize, the API/MCP edge proxy, either Wrangler config, or a card-processing, import, export or deletion run.
---

# Teak Core Worker

First read the sections of `apps/core-worker/README.md` the task touches and "Rules every change keeps" in `apps/docs/content/docs/(open-source)/architecture.mdx`. Load the `wrangler`, `workers-best-practices` and `durable-objects` skills as needed, and read current Cloudflare docs rather than memory.

## Invariants

- Workflow step names are durable history: never rename one, and add new steps after the existing ones.
- Every card-processing write carries the run's processing revision (`guardOf(job)`); a stale write ends the run as skipped, never overwriting newer work. Keep `processingStatus` consistent and every run reporting through `workflowDispatch.complete`.
- A `NonRetryableError` thrown in a step reaches the workflow as a plain `Error` whose message starts with `NonRetryableError: `; matching on a step error's message must allow for that prefix.
- Development binds only development resources (`apps/core-worker/development/wrangler.jsonc`); never point it at production buckets, indexes, routes or secrets.
- A binding, queue, cron, limit or container added to `wrangler.jsonc` also goes in the self-host config, `apps/core-worker/self-host/wrangler.jsonc`, in the same change (`src/deployment.test.ts` enforces it), without any account, route, resource ID or Teak value.
- After changing a Wrangler config, run `bun run cf-typegen` in `apps/core-worker`; never hand-edit `worker-configuration.d.ts`.

## Prove the change, cheapest first

1. `bun test <file>` in `apps/core-worker`, then `bun run test` and `bun run typecheck` there, and `bun run cf-typegen:check`.
2. Behavior that depends on the real Workflows engine (retries, errors crossing a step, completion reports) gets a case in `src/workflows/cardProcessing/engine.test.ts` (Wrangler's `createTestHarness`, no account needed).
3. For user-visible behavior, follow `.agents/skills/verify-teak/features/card-processing.md`: run the local end-to-end stack and read the run's steps, logs and stored objects in Local Explorer.

Report what changed, the commands run with results, and anything you couldn't reach (such as Containers without Docker, or remote bindings without a Cloudflare token).
