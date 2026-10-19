# Convex cost maintenance

Keep customer cards, assets, search results, and workflow retries intact. Use
Convex CLI production selectors explicitly; never run `dev` with production
credentials. Export a database snapshot before an approved migration or cleanup.
Snapshots contain private data and belong in a private directory outside Git.

## Raw provider metadata

Preview/category `raw` is internal scraped provider data. Public REST/SDK
responses and customer exports already project customer-facing fields. Grid
responses omit raw diagnostics. Display metadata, content, notes, tags, original
files, processing status, and card timestamps remain unchanged.

Payloads between 1 KiB and 512 KiB live in R2. Tiny or non-lossless JSON
values stay inline. The card-processing Workflow archives them itself
(`apps/files-worker/src/workflows/cardProcessing/rawMetadata.ts`): before the
link metadata and categorization writes, it registers the
user/card/kind/SHA-256 key, writes the JSON, reads it back and verifies its
hash and JSON, then sends Convex the reference (`rawStorageKey`, `rawSha256`)
instead of the payload. The mutation checks the key is the card's own and
schedules nothing. So the card is never written with the payload, and no
archive action reads it back and rewrites it.

`storage/rawMetadataMaintenance:archiveCard` still archives inline payloads:
old cards, a Worker archive that failed (the Workflow then sends the payload
inline), and manual migration pages. It writes through the signed Files Worker
path, reads the object back, verifies its hash and JSON, then compares the
current inline value before clearing it. Any failed verification or
concurrent change retains inline data. Backend enrichment securely hydrates
archived data; card/account cleanup and orphan scans track current references.

Old archive copies are deliberately retained for recovery. The orphan process
reports unreferenced objects; it does not delete them automatically. Review that
report periodically, then obtain an object-level listing before proposing
cleanup: aggregate counts/bytes do not identify safe deletion candidates.
Approve cleanup separately after checking each key against current references
and recovery needs. Never delete archive objects while cards reference them.

After explicit approval, process one bounded migration page at a time from
`packages/convex`:

```bash
bunx convex run --prod storage/rawMetadataMaintenance:archivePage '{"limit":25,"dryRun":true}'
bunx convex run --prod storage/rawMetadataMaintenance:archivePage '{"limit":25,"dryRun":false}'
```

Pass the returned cursor on each next page. Persist returned `failed` card IDs
and retry those individually after investigating; a failing card does not block
page progress. Stop at a null cursor. The default
is dry-run; deployment never schedules a whole-table migration. Each card can
retry twice; exhausted items retain their raw payload and can be retried later.
Compare card IDs/counts and every customer field against the snapshot, and
verify archived raw hashes, after migration. Keep the report with the snapshot.

Rollback requires the schema with optional archive fields to remain deployed.
Restore inline raw from verified archives or the snapshot using a guarded
mutation that checks the current reference and preserves concurrent edits.
Then roll back archive scheduling. Never replace whole cards from an old backup.

## Retention and usage

Teak sends no email of its own: WorkOS sends every sign-in email, and the
Resend component and its delivery-record cleanup were removed. Completed
workflow journals older than seven days use the existing guarded history
cleanup; active/recent/unknown histories are retained.

Use CLI usage warnings, not deployment-disable caps. Convex supports integer
thresholds, rejects monthly thresholds below already-incurred usage, and does
not send development warning emails. Revisit monthly thresholds after reset.
Monitor database I/O, egress, storage, and function calls separately; backfills
and one-off maintenance themselves consume I/O.

Remote preview images and media (up to 50 MiB) download on the Files Worker's
link fetcher Container straight into R2 (`store-remote-asset`), with the same
SSRF policy and pinned connections Convex used, bundled from Convex's own
files; they no longer pass through Convex. Link pages are fetched and scraped
there too (`fetch-link-page`); Convex gets back the selector results, and the
page itself only as a gzipped copy for the Instagram media parser. Never fetch
a user-supplied URL anywhere without that policy and pinning. Save PDF's
`store-linked-pdf` is the one exception: it fetches only
`https://arxiv.org/pdf/<id>` (redirects must stay on arxiv.org or
export.arxiv.org, over https) from the Worker itself, straight into R2.
Vimeo captions and podcast episode audio are fetched by card processing in the
Worker through the same SSRF-checked, pinned transport; episode audio streams
into a temporary R2 object (at most 100 MB, audio or MP4 only) that is deleted
after Whisper. Whisper runs are bounded by the `podcastTranscription` rate
limit (20 episodes an hour per account). Raw metadata archival calls only the
configured signed Files Worker.

Save by email (`apps/email-worker`, `packages/convex/inbound/`) costs one
`findSender` query per delivered email that passes DMARC, and one
`ingestEmail` mutation only for an account that turned it on. Only mail
failing DMARC is refused in the Worker before Convex is called; mail from an
unknown address reaches `findSender`, which answers 404. Neither call is rate
limited: `inboundEmailPerAccount` (60 an hour) caps only what is saved, and
past it `ingestEmail` records a dropped receipt. Each accepted attachment
adds one finalize request (an HTTP action with its claim, card and done
mutations). Attachment bytes never pass through Convex: the Worker PUTs them
to the Files Worker's signed upload URLs, and Convex only mints those and
finalizes. Receipts are pruned after 30 days by the Files Worker's daily
`cleanup-inbound-email-receipts` task.

Sign-up's getting-started files ship with the Files Worker as static assets
(`apps/files-worker/assets/onboarding/`), not in the backend bundle.
`card/onboardingFiles:addOnboardingCards` runs in the default runtime, not
Node: it registers the nine keys in one mutation, makes one
`store-onboarding-files` call that copies the files into R2 inside the Worker,
and inserts the cards in one mutation. No file bytes pass through Convex.

## Scheduled and edge work on Cloudflare

The Files Worker's Cron Triggers run the daily card and export cleanups,
email receipt pruning and admin snapshot, the weekly orphan sweep, the
6-hourly AI backfill, the hourly AI usage rollup, the hourly workflow
reconcile, and the hourly cleanups of the search
caches, abandoned import uploads, expired upload sessions and (once enabled)
idempotency records (`apps/files-worker/src/cron.ts`). Convex keeps only the
WorkOS event catch-up in `crons.ts`, which needs the WorkOS API key.
`cronSchedules.ts` lists both, so the admin health view still shows every
task.

The moved cleanups no longer start a Node action every hour, and the two
upload cleanups abort multipart uploads in the Worker instead of a Convex
action calling the Worker's signed `abort-multipart` op. Convex still runs the
table work: each page is one internal query or mutation called through the
workflow RPC gateway, an HTTP action plus that function, where the old crons
paid one call per page and continued themselves with the scheduler. A quiet
hour costs about the same number of calls as before, without the action
compute. Idempotency retention still continues itself in Convex once the
Worker starts it, so its lease and bursts are unchanged. The hourly pending-upload sweep
is gone: R2 event notifications delete each abandoned pending upload after a
day, and a weekly Worker sweep is the backstop, so Convex no longer pages the
bucket. The `pendingUploadCleanupStates` table is unused; it stays in the
schema until its old rows are gone (`.agents/sunset.md`).

An export no longer writes a row per card. Its workflow keeps the snapshot's
card ids in step state, so each exported card costs two document reads (one
when it is snapshotted, one when the archive reads its contents), where the
`exportJobItems` rows cost an insert, a delete and two more reads.

Imports no longer stage every item in Convex. The Files Worker's import
Workflow keeps the items it reads in R2 under the job's key namespace and
creates cards from there; Convex keeps the `importJobs` row and one
`importJobItems` row per failed item, which the failure samples and the
report read. Per imported item that removes the row insert with its content
(up to 100,000 characters, or a Markdown file of up to 512 KiB), its two
index reads while staging, the pending-item read, the re-read and status
patch when its card is made, the `setExtractedFile` mutation for an archive
file, and the row delete at cleanup. Each source page of up to 100 items now
costs one `recordPage` mutation (plus `recordFailures` when it has failed
items), and card batches still cost one mutation per five items, now with
the items in their arguments.

AI usage no longer costs a mutation per card. The Worker writes a Workers
Analytics Engine data point per model call, and the hourly rollup sets each
user's totals for today and yesterday in `aiUsageDaily` in batches of 200.

The AI gate (`adminAccess:getAiGate`, a gateway HTTP action plus the query)
used to be read before every AI step of a card run: two reads for a text
card, three or more for a link. The Worker now reuses each answer for 60
seconds in the isolate and the Cache API (`apps/files-worker/src/aiGate.ts`),
so a run reads it at most once and later runs for the same account within
the minute usually not at all. An admin's AI pause takes up to a minute to
reach running work.

Admin metrics are counted in the Worker. The daily snapshot no longer holds
every user and card in a Convex action, and `admin:getOverview` reads one
stored row instead of re-reading up to 10,000 cards on every card write while
an admin has it open. The page reads still bill Convex: the snapshot reads
every card once a day, as before, and the overview is counted from those same
pages, so it adds no reads. It is refreshed once a day (and on an admin's
"capture snapshot"), so its `generatedAt` can be up to a day old.

Analytics events from mutations (`card_created`, `user_signed_up`,
`card_processing_failed`, Save by email's) no longer schedule an action each.
They are `workflowDispatches` rows that the next flush hands to the Files
Worker, which sends them to PostHog. A card create already queues its
processing, so its event adds one small insert and delete and no function
call. Deployments without `POSTHOG_PROJECT_TOKEN` write no rows.

MCP sessions open with `initialize`, `notifications/initialized`, `tools/list`
and periodic `ping`s; the Worker answers those for a known user at the edge,
so only tool calls reach Convex's HTTP action. WorkOS webhooks are queued at
the edge and delivered with retries, so a burst never fans out into
concurrent HTTP actions.

## Operational cost rollout

Keep `OPERATIONAL_RETENTION_ENABLED` unset or `false` until the production
snapshot and dry-run report have been checked. Disabling retention stops
deletion; queued batches recheck the flag before deleting anything.

Text/link metadata always runs through the Files Worker's
`generate-text-metadata` and `generate-link-metadata` operations; the direct
Convex provider and its `FILES_TEXT_AI_ENABLED` switch were removed once the
deployed Worker answered both operations for the dev deployment. Convex holds
no Workers AI credentials.

Text/link metadata uses the Files Worker's Workers AI binding and the same Qwen model,
prompts, input limit, output validation and retry policy. Inputs are signed text,
not URLs to fetch. Keep call, error, latency, retry, token and cost aggregates;
routine successful traces are sampled at 10%, while failures, slow transactions
and auth/billing/security operations are retained. A deployment explicitly
repairs OAuth clients; the daily check remains as recovery.

Before enabling retention, export a private production snapshot outside Git.
Preview the indexed pages from `packages/convex`:

```bash
bunx convex run --prod operationalRetention:cleanupExpiredRecords '{"kind":"idempotency"}'
bunx convex run --prod operationalRetention:cleanupExpiredRecords '{"kind":"nativeAuthCodes"}'
```

Pass the frozen `cutoff` and returned `continueCursor` as `cursor` to inspect
later pages. Apply with `dryRun:false` only after checking eligibility. Each batch
reads at most 100 records/2 MiB. Twenty batches form a burst; additional pages
continue after five minutes using the same cutoff and cursor. A per-table
transactional scan lease prevents overlapping cron/manual runs; stale leases
recover their stored cursor after 15 minutes and fence old scheduled jobs. Pending API
reservations and unexpired replay responses are always retained. Native exchange
codes are eligible only after expiry plus 24 hours; this does not touch sessions,
users, accounts, OAuth tokens, signing keys or API keys. Compare preserved IDs and
customer fields against the snapshot after cleanup, accounting for real customer
activity. Never restore whole cards or auth records over concurrent changes.

Workflow queries/results now carry compact summaries. Necessary intermediate
values above 16 KiB are stored as immutable private R2 artifacts, verified by
byte count, SHA-256 and Convex-value round trip before a journal references them.
Existing journals and function identities remain readable. Remove referenced
artifacts only with terminal workflow history older than seven days. Retain
active/unknown histories for investigation. A bounded internal card manifest
tracks copies before upload, including failed attempts, so normal card/account
teardown discovers them. Canceled workflows retain journals for seven days before
artifact cleanup; no blanket R2 lifecycle deletion is safe. A rollback must retain the additive
artifact readers until all journals containing references have drained.

Legacy desktop codes, inactive component tables and revoked API keys remain
report-only. Do not remove them without a supported API and separate approval.
Recurring usage should be measured after the maintenance burst; exports, audits
and migrations themselves consume database I/O. These changes reduce avoidable
usage but do not guarantee zero overage as customer traffic grows.
