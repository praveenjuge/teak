# WorkOS migration readiness

Phase R capability checks passed with the approved revisions and recorded workarounds.
Phase 0 implementation is being verified in dev. Production authentication is unchanged;
production sign-ups remain open.
The approved migration plan is preserved in the encrypted backup as `approved-plan.txt.gpg`.
Baseline: `460a7b31a644a39463356b19fb83bd53a1424e9c`, version 1.0.75.

## User-approved revisions

- Backups: this Mac plus a new private temporary R2 bucket, with credentials and
  the encryption key in separate Keychain entries, replace the two offline drives.
- Skip Electron, which is an unshipped reference workspace. Partial native sign-in
  evidence exists; expiry refresh and sign-out are not proven.
- Replace the physical iPhone readiness check with an iOS simulator check.
- Use dated encrypted full Mac/R2 snapshots plus manual Convex backups instead of
  unsupported R2 versioning and Pro-only Convex scheduling (approved by the user).
- Verify the custom email domain in Phase 4 before cutover: WorkOS custom domains
  are only available in production environments.

## Gates

| Gate | Current result |
| --- | --- |
| 1. Managed team | Dev provisioned and admin access verified. User added the payment method; Convex confirms workspace access, payment configured, and production environment creation available. Actual production provisioning remains in Phase 4. |
| 2. Web | Password, Google, Apple, SDK refresh after real expiry, and sign-out passed. |
| 3. Apple | Own existing team, Services ID, and signing key; real Hide My Email relay matches both Better Auth environments. |
| 4. Mobile | Simulator S256 public PKCE, secure storage, original identity accepted over Convex WebSocket, rotated refresh after actual expiry, and sign-out passed. Sign-out reads secure storage as null and Convex identity as null. Provider logout redirects to the stopped localhost web spike; Phase 2 must configure native logout return UX. |
| 5. Electron | Skipped by user. |
| 6. Connect | Public PKCE, registered and unregistered loopback ports, both audiences, refresh rotation passed. No documented individual consent/revocation API found. Real-token HTTP proof lists the user's consent, revokes it, and denies old and freshly refreshed access tokens. The readiness denylist is in memory; Phase 3 must persist it in the canonical database. |
| 7. Third-party MCP | DCR and CIMD passed complete PKCE and refresh exchanges for both API and MCP audiences. |
| 8. JWT | `external_id`, `email`, boolean `email_verified`, session `sid`, 300-second access lifetime passed. |
| 9. Password import | Original NFKC-changing password failed. Use the plan's fallback: every password user resets once; never import production hashes. ASCII, accented Latin, and emoji passed. |
| 10. Lifecycle | Sessions list/refresh/revoke passed; revoked refresh denied. Signed create/update webhooks reached Convex. Signed registration Action Allow/Deny tests passed. All five email-delivery switches disabled, saved, and restored. Custom domain deferred by user. |
| 11. Flag | An env change re-ran the same open subscription in both directions without deployment; flag restored unset. |

Connect resource indicators must be present in authorization, token exchange,
and refresh requests. Authorization-only indicators produced the wrong audience.
Old Connect refresh tokens were accepted immediately and at 65 seconds after
rotation; do not claim replay protection. Keep endpoint consent revocation independent
of the provider's refresh behavior.

## Backup proof

Local source history, Convex dev/prod exports, explicit Better Auth models,
configuration, and all 4,093 production R2 card objects are encrypted.
The private temporary bucket contains checksum-verified encrypted copies.
All expected card files restored locally with matching SHA-256 and total size
(594,937,450 bytes). An anonymous local Convex backend restored all 84 data tables
and 74,100 documents with exact normalized document hashes, IDs, and creation times.
Authenticated ownership checks matched 835 and 200 exact card IDs for two accounts;
anonymous and cleared-auth reads were denied. This uses an isolated local JWT issuer,
so canonical application sign-in and the Phase 4 rehearsal remain required.

A fresh encrypted source/configuration/evidence checkpoint preserves 1,531 source
files and the dev runtime configuration. Local decryption and remote R2 SHA-256
passed: `readiness-checkpoint-1791028194.tar.gpg` (94,359,232 bytes).
The subsequent checkpoint includes the inert restore source and roundtrip snapshot:
`readiness-checkpoint-1791029202.tar.gpg` (101,155,200 bytes), locally decrypted and
remote checksum verified. No production service credentials were used by the restore.

Local evidence: `/Users/praveenjuge/Documents/TeakMigrationBackups/2026-10-03-phase-r`.
Remote bucket: `teak-workos-migration-backup-20261003`, private APAC Standard.
Never remove either copy before the approved retention period.

## Current constraints

No Phase 0 production freeze until the remaining Phase R gates pass or the user
explicitly revises them. No production deployment has been made for this migration.
Card ownership is immutable. Better Auth remains intact until Phase 6.
The clean shadow week, store-release lead time, notice, rollback window, and stable
weeks remain required; passing a build does not satisfy those time gates.

## Phase 0 preparation

The Better Auth flag, provider options, creation backstop, public auth-mode query,
web registration screen, mobile sign-up/welcome screens, and social error copy are
implemented. Dev freeze guards passed real-component integration tests, including
new native Google/Apple rejection, existing password/provider sign-in, and E2E
provisioning. Backend verification: 1,847 unit tests and 140 edge integration tests.
Web/mobile/backend typechecks pass. Environment audit passes with the existing
`APPLE_API_KEY_PATH` warning; setup and the web doctor pass.

Live dev Chrome proof: the registration page hid creation actions and preserved its
return path; an existing Google account signed in and retained 201 cards; removing
the flag reopened registration on the same page without a reload. The initial rehearsal restored the dev flag unset. After the backup replacement
approval, the dev freeze was enabled for Phase 0. Mobile simulator UI verification was skipped by explicit user request; its build was stopped.
The earlier Phase R simulator authentication evidence remains recorded.

Checkpoint `readiness-checkpoint-1791031277.tar.gpg` preserves 1,671 source files and
current evidence (101,513,108 bytes); local decryption and remote streamed SHA-256 both verified.

The backup replacement is approved: preserve dated encrypted full Mac/R2 snapshots
and manual Convex backups. Actual Phase 0 rollout and the post-freeze full
backup/restore remain outstanding; preparation does not complete Phase 0.

The full Phase 0 rollout and remaining gates are recorded in `phase-0.md`.

Production scheduled backups require Convex Pro and are currently Never; the user
approved the manual-backup replacement. Billing is unchanged.
