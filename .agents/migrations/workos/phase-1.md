# Phase 1 identity boundary

## Phase 1a: additive mapping

The `users` table preserves each original Better Auth user ID as `teakUserId`.
Better Auth create/update/delete triggers mirror normalized email and verification;
deletion leaves a permanent tombstone. Mirroring never changes a WorkOS link,
admin role, or card ownership. The quarantine and event tables are prepared for
later linking and webhook phases.

`migration/identityTable:backfill` is internal, processes 100 users per call, and
requires frozen sign-ups with Better Auth primary. Start with `{ "cursor": null }`,
then persist and pass `continueCursor` until `isDone`. Repeating a page is safe.
Never change card owner IDs.

`migration/identityTable:coveragePage` scans either `betterauth` or `users` with
`paginationOpts: { cursor: null, numItems: 100 }`. Follow each cursor and sum
`missing` and `mismatched`; both must be zero in both directions. Deleted mirrors
are reported separately as `tombstones`, not active orphaned accounts. Reports
contain counts and cursors, not emails or credentials.

The planned deletion helpers now live in `accountDeletion.ts`. Better Auth still
owns sign-in and all existing session/authorization behavior.

## Isolated verification: 2026-10-03

- Backfilled all 283 users from the coherent production restore. A checksum of
  original Better Auth IDs matches the new permanent owner IDs exactly.
- Repeated the complete backfill: all mapping row IDs remain unchanged.
- Both coverage directions scanned 283 users with zero missing or mismatched rows.
- Canonical sign-in still returns all 831 exact active card IDs with their original
  owner. A real WebSocket read and Chrome's restored card grid passed afterward.
- Seven component/database tests cover pagination, repeat runs, mirroring,
  link/role preservation, tombstones, coverage drift, and migration guards.
  Removing tombstone protection causes the deletion test to fail.
- All 1,851 backend unit tests and 155 edge integration tests passed.
- The restored backend has no production credentials or scheduled jobs.
  Original snapshots and encrypted Mac/R2 checkpoints remain preserved.

Private test reports and screenshots live in the approved migration backup folder.
Development/production deployment and backfill are pending review of Phase 1a.

## Remaining Phase 1 gates

Ship the branded, read-only resolver and ownership call-site changes in shadow
mode; re-key uploads, seed stable admin roles, and add the raw-identity CI rule.
Keep `IDENTITY_RESOLVER_ENFORCE` unset until production coverage is zero and a full
week of shadow logging has no mismatch. Unsetting that flag is the enforcement
rollback. Phase 1 is not complete until those gates and its full backup repeat pass.
