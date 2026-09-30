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
report periodically and approve cleanup separately after confirming references
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
