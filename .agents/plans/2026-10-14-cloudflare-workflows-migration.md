## Goal

Move all 13 Convex workflows (`@convex-dev/workflow`) to Cloudflare Workflows running inside `apps/files-worker`, then remove `@convex-dev/workflow` from Convex. Convex stays the database and the reactive read layer. Cloudflare becomes the only background orchestrator. It ships as one hard cutover.

Why:

- Convex cost. Workflow journals, workpool polling, the 16 KiB R2 journal-artifact workaround, and HMAC round trips each add function calls.
- Reliability and limits. There is one shared `maxParallelism: 10` pool, a weekly stuck-workflow reaper, and a 5-minute account-deletion redrive.
- Colocation. Steps call Workers AI, R2, Browser Run and the media Container through bindings, with no 90–300 s HMAC hop.
- Observability. The Cloudflare dashboard shows each instance and each step, with pause, resume, restart and terminate.

## Success Criteria

- `@convex-dev/workflow` and the `workflow` component are gone from `packages/convex/convex.config.ts` and `package.json`, and so is `@convex-dev/workpool`, which is only used for a type.
- These files are deleted:
  - `workflows/manager.ts` (the start, onComplete, reaper and journal-cleanup code)
  - `storage/workflowArtifacts.ts`
  - the `reap-stuck-workflows` cron
- Every card type still ends with each `processingStatus` stage `completed` or `failed`, with no stage stuck `pending`. The one rule in root `AGENTS.md` ("preserve workflow retries and `processingStatus` consistency") still holds. Its pointer to `cardProcessing.ts` is updated to the new location.
- Editing a card ends its old processing run. Stale AI output can never overwrite newer output.
- The UI shows live `in_progress` for each stage.
- A Workers AI 429 is retried inside the workflow with a delay. It no longer waits up to 6 h for the backfill.
- Dev workflows run on `teak-files-development` and can only write to the dev Convex deployment. Prod can only write to prod.
- Shipped native clients keep working. `processingStatus` keeps its shape, and `in_progress` is already a valid value.
- CI is green with three test layers:
  - workflow tests in `vitest-pool-workers`
  - contract tests on the Convex HTTP ops
  - an E2E card-processing test in `packages/tests`

## Context And Current Facts

- Convex already holds no AI or R2 credentials. All heavy work runs on `apps/files-worker` (`teak-files-proxy`, `files.teakvault.com`), reached through HMAC-signed POSTs to `/__ops/v1`:
  - client: `storage/filesWorkerClient.ts`
  - ops: `packages/files-protocol/src/index.ts`
- Worker bindings: `BUCKET`, `AI`, `IMAGES`, `BROWSER`, and the Durable Objects `OBJECT_GATES` and `MEDIA_RENDERER` (a Container, max 4 instances).
- The one exception is arbitrary-URL fetching. It stays on Convex on purpose, using the DNS-pinned SSRF guard `steps/pinnedFetch.ts` (an undici `Agent`). Callers:
  - `fetchMetadata`
  - categorization `fetchStructuredDataStep`
  - the screenshot HTML fetch

  `.agents/convex-costs.md` forbids moving these fetches without an equivalent guard.
- Workflows today: one `WorkflowManager` (`workflows/manager.ts:45`) with `maxParallelism: 10`. All starts go through `startWorkflow()`, whose `onComplete` marks the stages it owns as failed and cleans up the journal and R2 artifacts after 7 days.

| # | Workflow | File | Trigger |
|---|---|---|---|
| 1 | cardProcessing | `workflows/cardProcessing.ts` | createCard mutation, `startCardProcessingWorkflow` (upload, update, reprocess, bulk API, admin) |
| 2 | linkMetadata | `workflows/linkMetadata.ts` | legacy, tests only |
| 3 | linkEnrichment | `workflows/linkEnrichment.ts` | legacy, no callers |
| 4 | screenshot | `workflows/screenshot.ts` | `steps/metadata.ts:436` for links |
| 5 | aiMetadata | `workflows/aiMetadata/index.ts` | backfill |
| 6 | aiBackfill | `workflows/aiBackfill.ts` | cron every 6 h, admin |
| 7 | cardCleanup | `workflows/cardCleanup.ts` | cron daily 02:00, restarts itself |
| 8 | export | `workflows/export.ts` | `dataExport.ts:237` |
| 9 | exportCleanup | `workflows/exportCleanup.ts` | cron 03:00, restarts itself |
| 10 | import | `workflows/import.ts` | `dataImport.ts:356` |
| 11 | objectDeletion | `workflows/objectCleanup.ts` | `storage/r2.ts:119`, `import/runImport.ts:423` |
| 12 | accountDeletion | `workflows/accountDeletion.ts` | `accountDeletion.ts:518`, cron redrive every 5 min |
| 13 | (reaper / journal cleanup) | `workflows/manager.ts` | cron weekly |

- Size:
  - `workflows/`: 8.7k LOC in 51 files, including 5.1k LOC of steps in 26 files.
  - Workflow tests: 31 Bun files (9.7k LOC) with mocked ctx, plus convex-test files that use `workflowTest.register`.
- `processingStatus` stages are classify, categorize, metadata, renderables and screenshot. Each has a status of `pending | in_progress | completed | failed`.
  - `in_progress` is defined but never written.
  - Writers merge into the current value, so parallel stages are safe (`card/processingStatus.ts`).
- Cloudflare Workflows limits, Workers Paid, checked against the docs on 2026-10-14:
  - Instances: 50k concurrent, created at 100/s per workflow.
  - Steps: 10k–25k per instance, up to 10k retries each.
  - Data: step return values and event payloads up to 1 MiB each, 1 GB of state per instance.
  - Timeouts: 30 minutes or less per step attempt.
  - Retention: 30 days.
  - Steps get `ctx.attempt`, dynamic retry `delay` functions, `NonRetryableError` and `rollback`.
  - Workflows support `waitForEvent` and `sendEvent`, `createBatch`, cron `schedules` (with a free one-hour concurrency budget per firing), and pause, resume, restart and terminate.
- Dev currently shares the prod Worker and bucket (`R2_KEY_PREFIX=dev/`). `apps/files-worker/development/wrangler.jsonc` (`teak-files-development`) is prepared but not active.
- Web and docs are on Vercel. Convex deploys after `scripts/check-files-readiness.ts` confirms a compatible Worker (`.github/workflows/backend-deploy.yml:41`).

## Decisions (owner Q&A, 2026-10-14)

| Topic | Decision |
|---|---|
| Scope | All 13 at once, as one cutover release |
| Worker home | Inside `apps/files-worker`, as new `WorkflowEntrypoint` classes |
| Cloudflare → Convex | HMAC-signed Convex HTTP actions (`/__workflow/v1/<op>`) that call internal functions. No admin or deploy key leaves Convex |
| URL fetching | Re-implement the SSRF guard in the Worker. Convex no longer fetches arbitrary URLs |
| Environments | Turn on `teak-files-development`, so each Worker is bound to exactly one Convex site URL |
| Dispatch | Outbox table + `runAfter(0)` dispatcher action + `createBatch` with deterministic instance IDs |
| Cutover | Hard cutover: cancel in-flight Convex workflows and re-drive them on Cloudflare |
| Crons | Cloudflare Workflow `schedules` for the workflow crons. The reaper and the deletion redrive are deleted |
| Upgrades | Cancel on edit, a real `in_progress` status, AI 429 retries with a delay |
| Account deletion | Ported with the rest, no special track |
| Tests | vitest-pool-workers + contract tests + E2E |

## Architecture

```
Convex mutation (createCard, updateCard, dataExport, ...)
  ├─ db.insert/patch card
  ├─ db.insert workflowDispatches {kind, key, params, state: "pending"}
  └─ scheduler.runAfter(0, internal.workflowDispatch.flush)
          │  HMAC POST /__ops/v1  op=start-workflows  (new files-protocol op)
          ▼
files-worker
  ops.ts → env.CARD_PROCESSING.createBatch([{id: "card:<id>:<rev>", params}])
  class CardProcessingWorkflow extends WorkflowEntrypoint
     step.do("load card")        ─┐
     step.do("set classify in_progress") │  HMAC POST {CONVEX_SITE_URL}/__workflow/v1/<op>
     step.do("classify") …       ─┘    → Convex httpAction → internal query/mutation
     bindings used directly: AI, BUCKET, BROWSER, MEDIA_RENDERER, IMAGES
          │
          ▼  final step: POST /__workflow/v1/complete  (replaces onComplete)
Convex: mark dispatch done; mark owned stages failed if status=errored
```

- **One protocol, both directions.** Add to `packages/files-protocol`:
  - a `WORKFLOW_OPS` registry
  - zod schemas for each op's params and result
  - the shared HMAC signer

  Convex exposes one `httpAction` at `/__workflow/v1`. It verifies the signature, a timestamp window and a nonce, then dispatches to `internal.*` functions. This mirrors `apps/files-worker/src/ops.ts`.
- **Write-back ops are coarse.** Each op does one meaningful mutation, such as `card.setStage`, `card.saveAiMetadata` or `card.saveRenderables`. This keeps the number of Convex function calls low, which is the reason for doing this.
- **Revision guard.** Every write-back carries `{cardId, rev}`. Convex rejects writes when `card.processingRev !== rev`, and the rejection makes the step throw `NonRetryableError`. This is the safety net for cancel on edit, even if `terminate` arrives late.
- **Large data.** Step results stay under 1 MiB. Raw HTML and transcripts go to R2 under `workflow/<instanceId>/…`, and the step returns the key. The Workflow `retention` setting (`successRetention: "7 days"`) together with an R2 lifecycle rule on `workflow/` replaces `storage/workflowArtifacts.ts` and the journal cleanup.

## Phases

The release is one cutover, but the work lands on one branch in these steps. Each step has its own tests.

### 0. Groundwork

- Turn on `teak-files-development` with its own `CONVEX_SITE_URL` and `WORKFLOW_SIGNING_SECRET`. Point dev Convex `FILES_BASE` at it. Add both to `scripts/env-contract.ts` and `.agents/environment.md`.
- Add `processingRev: v.optional(v.number())` to `cards`, and a `workflowDispatches` table with indexes `by_state_createdAt` and `by_key`. This is a schema change, so it needs the owner's approval per `packages/convex/AGENTS.md`.
- Build `/__workflow/v1` in Convex (`http.ts`) and the matching client in the Worker (`src/convexClient.ts`), with contract tests on both sides.
- Set up `vitest-pool-workers` in `apps/files-worker` with workflow introspection.

### 1. Worker SSRF guard (security gate; nothing else ships without it)

- `src/safeFetch.ts` follows these rules:
  - only `http` and `https`, and only default or allowlisted ports
  - resolve A and AAAA over DoH (`1.1.1.1/dns-query`) and reject private, loopback, link-local, CGNAT, metadata (`169.254.169.254`), ULA and IPv4-mapped ranges
  - `redirect: "manual"`, with every hop re-resolved and re-checked, up to 5 hops
  - limits on body size, time and content type, matching `steps/pinnedFetch.ts`
- **Open risk: DNS rebinding.** Workers `fetch()` resolves DNS itself, so a check-then-fetch has a gap between the check and the request. Spike these two options and pick one in a written security review:
  - (a) Rely on Cloudflare egress not routing to private space, plus the DoH pre-check. Document what is left exposed: other Cloudflare-proxied hosts and Cloudflare's own internal hostnames.
  - (b) Use `cloudflare:sockets` `connect()` to the vetted IP, with TLS SNI set to the hostname, if the runtime supports it.

  Port the `pinnedFetch` test cases as they are.
- Update `.agents/convex-costs.md` to record that the guard moved and why it is still equivalent.

### 2. Port step code

- Most of `workflows/steps/*` is pure logic around Worker ops. Move it into `apps/files-worker/src/workflows/steps/` and swap `callFilesWorkerJson(op)` for direct calls to the existing Worker functions:
  - `textMetadata.ts`, `imageMetadata.ts`, `transcript.ts`
  - `browserRender.ts`
  - `mediaRenderer.ts`
- Shared, pure modules, such as classification heuristics, link categories, `processingStatus` helpers and the X/Instagram parsers, move into `packages/files-protocol` or a new `packages/pipeline`. Convex and the Worker then import the same code.
- Move the Bun step tests into the Worker package next to the code. Most need only import-path changes.

### 3. Workflow classes (in `apps/files-worker/src/workflows/`)

| Convex | Cloudflare class | Notes |
|---|---|---|
| cardProcessing | `CardProcessingWorkflow` | Instance id `card:<id>:<rev>`. Same stage order: images and videos run sequentially; other types run metadata and renderables in parallel with `Promise.all` over `step.do`. Write `in_progress` before each stage. Retry configs carry over. Metadata gets a dynamic `delay` for 429s (`rate limit → attempt × 30s`, limit about 10). The final step emits completion telemetry and calls `complete` |
| screenshot | Folded into `CardProcessingWorkflow` | Runs as a step after link metadata. Replaces the hand-rolled `runAfter` retry loop with a step retry config (`renderer_unavailable` → 3 × 30s constant) |
| aiMetadata | `AiMetadataWorkflow` | Used by reprocess-AI-only and backfill |
| aiBackfill | `AiBackfillWorkflow` + `schedules: "0 */6 * * *"` | Runs much less often now that 429s retry inline. It now catches only cards that stay failed. Uses `createBatch` |
| linkMetadata, linkEnrichment | **Deleted** | Legacy, with no production callers |
| cardCleanup, exportCleanup | `…Workflow` + `schedules` | Loop inside one instance instead of restarting itself |
| export, import | `ExportWorkflow`, `ImportWorkflow` | Keep `step.sleep` for card rate limiting. Job tables stay in Convex. Steps call `job.*` write-back ops |
| objectDeletion | `ObjectDeletionWorkflow` | Calls `BUCKET.delete` directly. Started from Convex through the outbox |
| accountDeletion | `AccountDeletionWorkflow` | Six stages, each a step loop. Durable retries replace the 5-min redrive cron. Failure → `recordFailure` write-back |
| reaper, journal cleanup | **Deleted** | Replaced by Workflow retention and the R2 lifecycle rule |

- Add the `workflows` bindings and `limits` in both `wrangler.jsonc` files.
- Set `default_retention` on every workflow.

### 4. Convex side

- `workflowDispatch.flush` (internalAction): reads pending rows, POSTs `start-workflows` in batches of up to 100, then marks them `sent`.
  - Because instance IDs are deterministic, a repeat POST is a no-op: a duplicate-ID error counts as success.
  - An hourly cron re-drives rows still `pending` after 5 min.
- Cancel on edit. In `updateCard` and reprocess:
  - bump `processingRev`
  - reset the stages (`initializeCardProcessingState` logic)
  - insert a dispatch row with `terminate: "card:<id>:<oldRev>"` and `start: "card:<id>:<newRev>"`

  The Worker terminates the old instance (best effort) and creates the new one. The revision guard covers any race.
- Replace every `startWorkflow`, `startCardProcessingWorkflow` and `start*Workflow` call site:
  - `card/createCard.ts:278`, `card/defaultCards.ts:498`
  - `card/uploadCard.ts:299`, `card/updateCard.ts:257/496/687`
  - `publicApi.ts:1747`, `admin.ts:794/857`
  - `dataExport.ts:237`, `dataImport.ts:356`
  - `storage/r2.ts:119`, `import/runImport.ts:423`
  - `accountDeletion.ts:518`
- `complete` op: marks the dispatch `done`. On `errored`, it runs the existing `markUnfinishedCardStagesFailed` logic for the stages that workflow owns.
- A Worker-side safety net replaces the reaper: a weekly `schedules` job lists `errored` instances through the Workflows API and makes sure Convex was told.
- Delete:
  - the URL-fetch code: `steps/pinnedFetch.ts`, `safeFetch` and the undici dependency, once nothing uses them
  - `@convex-dev/workflow`, `@convex-dev/workpool`
  - `manager.ts`, `workflowArtifacts.ts`
  - the `reap-stuck-workflows`, `ai-metadata-backfill`, `cleanup-old-deleted-cards`, `cleanup-expired-exports` and `redrive-account-deletion` crons
- The remaining `runAfter` calls stay on Convex: telemetry, search sync, onboarding, tags and folders. They are not workflows.

### 5. UI

- `packages/ui/src/components/cards/cardDisplay.ts` already reads stage status. Add an `in_progress` label for each stage ("Reading page…", "Generating tags…", "Rendering preview…").
- Check the public API, the MCP and OpenAPI schemas, and the native apps. `in_progress` is already in the schema enum, so no client break is expected. Verify this on the Apple and Android decoders.

### 6. Hard cutover runbook

1. Deploy the Worker with the workflows (they stay inactive until Convex dispatches to them). `check-files-readiness` must assert that the new op version exists.
2. Deploy Convex with dispatch switched to Cloudflare. In-flight Convex workflows keep running only until step 3.
3. Run the one-time internal action `migrations.cutoverWorkflows`:
   - Cancel every in-progress `@convex-dev/workflow` run.
   - Cards with a non-final stage: bump `processingRev` and dispatch a fresh `CardProcessingWorkflow`.
   - Export, import and account-deletion jobs that are not terminal: dispatch the matching workflow with the job ID. Each must resume from the job row's recorded phase or stage, not from the beginning.
4. Watch the Cloudflare dashboard and PostHog for 24 h: error rate, `processingStatus` failures, and the latency from creation to completed.
5. Follow-up deploy: remove the workflow component and its tables.

## Testing

- **`vitest-pool-workers`** in `apps/files-worker`. Each workflow class runs under workerd with `introspectWorkflowInstance` to mock step results, force retries and errors, and skip sleeps.

  Cases:
  - each card type's stage order
  - parallel metadata and renderables
  - renderables exhausted → stage failed and the workflow continues
  - a 429 retried with a delay
  - a stale-revision write-back → `NonRetryableError`
  - account deletion stage resume
  - import resume after cutover
- **Contract tests.** Each `WORKFLOW_OPS` schema is tested in the Worker (request shape) and in Convex (convex-test on the httpAction: valid signature, bad signature, replayed nonce, stale revision).
- **SSRF suite.** Port the `pinnedFetch` cases and add rebinding, redirect-to-private, IPv6-mapped and decimal-IP cases.
- **E2E** in `packages/tests`. Create a link card, an image card and a text card in the web app against the local stack, with the Worker running under `wrangler dev`/miniflare. Assert that every stage reaches `completed`, and that editing a card mid-run leaves only the newer AI output.
- Delete the convex-test `workflowTest.register` usages. Keep convex-test for the outbox, the dispatcher and the HTTP ops.

## Risks

- **SSRF rebinding** (phase 1) is the main security risk. If the spike cannot reach equivalence, the fallback is a Convex HTTP op `fetch-url` that runs the existing `pinnedFetch`, used from the Worker. The rest of the plan does not change.
- **Hard cutover plus all 13 at once.** Long-running jobs (import, export, account deletion) must resume from their job-row state. Each needs an explicit test for "resume from phase N". Account deletion has no dry run (by choice), so its resume test is required before cutover.
- **Container saturation.** Workflows can now run far more than 10 at once, but `MEDIA_RENDERER` is capped at 4 instances. Image, video and PDF renderables need a retry with a delay on `renderer_unavailable`, or a semaphore in `OBJECT_GATES`.
- **Workers AI rate limits.** 50k concurrent instances against one AI binding means a large import can hit 429s hard. Throttle `createBatch` per user, or put the AI steps behind a concurrency-limiting Durable Object.
- **files-worker deploy coupling.** File serving and workflows deploy together. A bad workflow deploy is a file-serving rollback, and the reverse is also true. Since step history is durable, a rollback must keep step names and the order of results compatible. Treat step names as an API.
- **Convex function cost moves, it does not disappear.** Each write-back is still a Convex call. Measure calls per card before and after, using the PostHog backend events, to confirm the cost goal.

## Ideas For Later

- **Embeddings and OCR** (roadmap v2): add them as steps in `CardProcessingWorkflow` that write to Vectorize directly, without a new Convex workflow.
- **AI Gateway** in front of Workers AI for caching, logging and per-model rate limits.
- **`waitForEvent` for human-in-the-loop**, for example "AI tags ready — accept?" or pausing an import until the user confirms duplicates.
- **Per-user fairness.** Make a Durable Object the token bucket for each user, so one large import cannot starve other users' new cards.
- **Instance `subscribe`** to stream step events to the web app over the Worker for very fine progress, if Convex `in_progress` updates are not fine-grained enough.
- **Queues** for the fire-and-forget Convex `runAfter` jobs (telemetry, search sync), if Convex scheduled-function cost turns out to matter after this migration.
