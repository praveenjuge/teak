# Phase 1 identity boundary

## Phase 1a: additive mapping

The `users` table preserves each original Better Auth user ID as `teakUserId`.
Better Auth create/update/delete triggers mirror normalized email and verification;
deletion leaves a permanent tombstone with email cleared and verification reset. Mirroring never changes a WorkOS link,
admin role, or card ownership. The quarantine and event tables are prepared for
later linking and webhook phases.

`migration/identityTable:backfill` is internal, processes 100 users per call, and
requires frozen sign-ups with Better Auth primary. Start with `{ "cursor": null }`,
then persist and pass `continueCursor` until `isDone`. Repeating a page is safe.
Never change card owner IDs.

`migration/identityTable:coveragePage` takes
`{ "direction": "betterauth", "paginationOpts": { "cursor": null, "numItems": 100 } }`.
Repeat with `"direction": "users"` for the reverse scan. Pass each returned
`continueCursor` as `paginationOpts.cursor` until `isDone`. Sum
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
- Nine component/database tests cover pagination, repeat runs, mirroring,
  link/role preservation, tombstones, coverage drift, and migration guards.
  The public signup/delete HTTP flow leaves a redacted tombstone. Removing
  deletion-trigger wiring or tombstone protection causes the relevant test to fail.
- All 1,851 backend unit tests and 157 edge integration tests passed.
- The restored backend has no production credentials or scheduled jobs.
  Original snapshots and encrypted Mac/R2 checkpoints remain preserved.

Private test reports and screenshots live in the approved migration backup folder.
PR #486 merged as `8add1d7e9cc6ede1710e7069ceaba968e4afea35`.
Development deployment and all 142 mappings passed. Production Backend Deploy run
`37136832684` succeeded; all 283 mappings passed. Both coverage directions report
zero missing/mismatched rows in each environment. Production Chrome still shows
831 cards and the existing Pro plan. Better Auth remains primary and sign-ups
remain frozen. Fresh pre-backfill dev/prod snapshots, all eight provider models,
and configuration were encrypted, decrypted locally, and checksum-verified in R2.

## Remaining Phase 1 gates

Ship the branded, read-only resolver and ownership call-site changes in shadow
mode; re-key uploads, seed stable admin roles, and add the raw-identity CI rule.
Keep `IDENTITY_RESOLVER_ENFORCE` unset until production coverage is zero and a full
week of shadow logging has no mismatch. Unsetting that flag is the enforcement
rollback. Phase 1 is not complete until those gates and its full backup repeat pass.

## Phase 1b shadow candidate: 2026-10-04

The read-only boundary now returns branded permanent IDs for session, bearer,
serialized job, and upload ownership paths. It retains live Better Auth session
revocation. Shadow mismatches log reason counts without identities. Enforcement
remains a separate operator gate; this candidate does not enable it.

The Biome CI plugin rejects direct, bracket, optional, destructured, and aliased
raw identity access outside the boundary. Executable fixtures exercise the rule.
API/Raycast read helpers and upload creation retain the brand after serialized
owners are resolved. Upload sessions use permanent owners; legacy resumable
sessions are denied and left to normal expiry.

Real component/HTTP tests prove original-vault API/MCP access in shadow mode,
foreign-card denial, strict missing/tombstoned mapping denial, and key revocation.
An intentional strict-condition inversion fails both session and bearer tests.
The isolated restore passes canonical sign-in, all 831 exact card IDs/original
owners, a real WebSocket subscription, and the Chrome card grid.

Admin seeding is prepared but not yet run live. Email-based admin authorization
stays active until both deployment seeds are verified; a following change will
switch authorization to the stable role. The production shadow week has not
started. Phase 1b remains a reviewed candidate until its PR/checks/deployments pass.

Development shadow candidate deployed to `reminiscent-kangaroo-59` on 2026-10-04.
Both directions still cover all 142 users with zero missing/mismatched rows.
Real Google sign-in returns the existing 201-card Pro account in Chrome. The user
approved `hello@praveenjuge.com` as admin in both environments; its dev role is
seeded. Production admin seeding remains pending the production deployment.

PR #488 review follow-ups cover real OAuth and API-key mapping/revocation,
upload-action denials, upload URL/finalized owner consistency, internal creation,
Raycast and idempotent restore guards, and terminal import denial. The full backend
passes 1,851 unit and 174 component integration tests. All 29 lint fixtures pass.
Removing the profile fallback fails its regression test. The import workflow now
finalizes failed mapping resolution rather than leaving an active job stranded.
