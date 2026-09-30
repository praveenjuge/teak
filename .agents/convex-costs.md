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

Payloads between 1 KiB and 512 KiB move to the existing signed Files Worker/R2
path. Tiny or non-lossless JSON values stay inline. The archive writes a
user/card/kind/SHA-256 key, reads it back, verifies its hash and JSON, then
compares the current inline value before clearing it. Any failed verification
or concurrent change retains inline data. Backend enrichment securely hydrates
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

Finalized Resend delivery records expire after seven days; unfinished records
after 28 days. Daily cleanup is bounded by the Resend component. This never
deletes cards. Sentry checks cover the initial bounded deletion batches;
Resend-owned continuation jobs report failures through Convex scheduled-job
health/logs. Verify retention counts after manual cleanup. Completed workflow journals older than seven days use the
existing guarded history cleanup; active/recent/unknown histories are retained.

Use CLI usage warnings, not deployment-disable caps. Convex supports integer
thresholds, rejects monthly thresholds below already-incurred usage, and does
not send development warning emails. Revisit monthly thresholds after reset.
Monitor database I/O, egress, storage, and function calls separately; backfills
and one-off maintenance themselves consume I/O.

Arbitrary-domain preview downloads remain on Convex. Its canonical downloader
pins validated DNS results across redirects; the current Workers fetch surface
cannot preserve that guarantee. Do not move this path without equivalent SSRF
protection. Raw metadata archival calls only the configured signed Files Worker.

## Operational cost rollout

Keep `OPERATIONAL_RETENTION_ENABLED` and `FILES_TEXT_AI_ENABLED` unset or `false`
until the deployed Files Worker advertises both metadata operations and the
production snapshot and dry-run report have been checked. Deploy Worker support
before the Convex consumer. Enable text AI first, verify an isolated text/link
journey, then enable retention. Disable either flag to stop its new work; queued
retention batches recheck the flag before deleting anything.

Text/link metadata uses the existing Workers AI binding and the same Qwen model,
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
continue after five minutes using the same cutoff and cursor. Pending API
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
