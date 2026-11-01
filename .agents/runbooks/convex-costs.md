# Convex cost maintenance

Last reviewed: 2026-11-01

How to run Convex maintenance on Teak's own deployments without losing
customer data, and which work already moved off Convex to keep its bill down.
Keep customer cards, assets, search results and workflow retries intact.

## Ground rules

- Use Convex CLI production selectors explicitly (`--prod`); never run `dev`
  with production credentials.
- Before an approved migration or cleanup, export a database snapshot to a
  private directory outside Git (snapshots hold private data). Afterwards,
  compare card IDs, counts and every customer field against it, and keep the
  report beside it.
- Never replace whole cards or auth records from an old backup; restore with
  a guarded mutation that checks the current value and keeps concurrent edits.
- Use CLI usage warnings, not deployment-disable caps. Convex takes integer
  thresholds only, refuses a monthly threshold below usage already incurred,
  and sends no warning emails for development. Revisit thresholds after each
  monthly reset, and watch database I/O, egress, storage and function calls
  separately: backfills and maintenance consume I/O too.

## Raw provider metadata

Preview and category `raw` is internal scraped provider data; public API,
SDK and export responses already project only customer fields, and grid
responses omit it. Payloads between 1 KiB and 512 KiB live in R2.

- The card-processing Workflow archives new payloads itself
  (`apps/core-worker/src/workflows/cardProcessing/rawMetadata.ts`): it writes
  the JSON, reads it back, verifies hash and JSON, and sends Convex only the
  reference (`rawStorageKey`, `rawSha256`).
- `storage/rawMetadataMaintenance:archiveCard` archives inline payloads that
  remain (old cards, failed Worker archives, manual pages). Any failed
  verification or concurrent change keeps the inline value.
- Old archive copies stay for recovery. The orphan sweep reports
  unreferenced objects and never deletes them. Before proposing a cleanup,
  get an object-level listing and check each key against current references;
  get approval for the cleanup separately. Never delete an object a card
  references.

After explicit approval, migrate one bounded page at a time from
`packages/convex`, passing the returned cursor each time until it is null:

```bash
bunx convex run --prod storage/rawMetadataMaintenance:archivePage '{"limit":25,"dryRun":true}'
bunx convex run --prod storage/rawMetadataMaintenance:archivePage '{"limit":25,"dryRun":false}'
```

Keep the returned `failed` card IDs and retry them one by one after
investigating; each card retries twice and keeps its payload when it runs
out. Rollback needs the schema's optional archive fields to stay deployed.

## Operational retention

The hourly cleanup deletes expired idempotency records in bursts on every
deployment. Preview its pages from `packages/convex` before any manual run:

```bash
bunx convex run --prod operationalRetention:cleanupExpiredRecords '{"kind":"idempotency"}'
bunx convex run --prod operationalRetention:cleanupExpiredRecords '{"kind":"nativeAuthCodes"}'
```

Pass the frozen `cutoff` and the returned `continueCursor` as `cursor` for
later pages, and apply with `dryRun:false` only after checking eligibility.
Each batch reads at most 100 records or 2 MiB; twenty batches make a burst,
and a per-table lease stops overlapping runs (a stale lease recovers after
15 minutes). Pending API reservations and unexpired replay responses are
always kept; native exchange codes become eligible 24 hours after expiry.
Sessions, users, accounts, OAuth tokens, signing keys and API keys are never
touched.

Workflow results above 16 KiB are stored as private R2 artifacts, verified
before a journal references them. Remove an artifact only with terminal
workflow history older than seven days; keep active and unknown histories.
No blanket R2 lifecycle deletion is safe. Legacy desktop codes, inactive
component tables and revoked API keys stay report-only.

## What already moved off Convex

So a change doesn't move it back:

- **Files and fetching.** Remote images and media (up to 50 MiB), link pages,
  Vimeo captions, podcast audio and arXiv PDFs are fetched in the Core Worker
  (the link fetcher Container) straight into R2, under the SSRF policy and
  pinned connections. Never fetch a user-supplied URL anywhere without them.
  Getting-started files ship as Core Worker assets
  (`apps/core-worker/assets/onboarding/`).
- **Scheduled work.** The Core Worker's Cron Triggers run the cleanups,
  sweeps, AI backfill and usage rollup, and the workflow reconcile
  (`apps/core-worker/src/scheduled/cron.ts`); Convex keeps only the WorkOS
  event catch-up in `crons.ts`. `cronSchedules.ts` lists both for the admin
  health view.
- **Exports and imports** keep their working set in workflow step state and
  R2, not per-item Convex rows; only failed import items get an
  `importJobItems` row.
- **AI usage** is written to Workers Analytics Engine and rolled up hourly
  into `aiUsageDaily`. The AI gate is cached for 60 seconds in the Worker
  (`apps/core-worker/src/ai/aiGate.ts`), so an admin's AI pause takes up to a
  minute to reach running work.
- **Admin metrics** are counted in the Worker's daily snapshot;
  `admin:getOverview` reads one stored row, up to a day old.
- **Analytics events from mutations** ride the workflow dispatch outbox to
  the Core Worker, which sends them to PostHog.
- **MCP session traffic** (`initialize`, `tools/list`, `ping`) is answered at
  the edge for a known user; only tool calls reach Convex.
- **Save by email** costs one `findSender` query per email that passes DMARC
  and one `ingestEmail` mutation only for accounts that turned it on;
  attachment bytes never pass through Convex.
