# WorkOS migration readiness

Historical Phase R capability checks passed with the approved revisions and recorded workarounds. The Connect logout/reconnect gate is reopened by the live findings below.
Phase 0 is deployed and its backup/restore gate passed. Development and production
remain on Better Auth with sign-ups frozen. The current rollout evidence and exact
post-freeze inventories are recorded in `phase-0.md`.
The approved migration plan is preserved in the encrypted backup as `approved-plan.txt.gpg`.
Baseline: `460a7b31a644a39463356b19fb83bd53a1424e9c`, version 1.0.75.

## Current Connect runtime correction (6 October 2026)

Live dev and production discovery omit `revocation_endpoint`. Two fresh,
signature/nonce-verified dev CIMD authorizations reused the same consent ID.
Permanent local consent denial therefore blocks reconnecting to that grant.
The earlier denylist proof establishes denial, not a working logout/reconnect
journey. The user approved application-wide disconnect on 6 October.
The exact dev CIMD experiment then received provider DELETE 204, rejected the
retained old refresh token with 400 invalid_grant before and after reenrollment,
and verified a distinct signed replacement consent ID. Its hash-chained private
transcript is retained. A separately held, 7.864-second-old authorization code
also returned invalid_grant after provider deletion. No other application grants
existed in that fixture, so this is not a live sibling-client control.
The grouped backend/client correction passed independent review and local tests;
deployment and the migrated application journey remain unproven.
WorkOS's provider revocation applies across the same user's application resources
and installations. No production authentication switch is approved here.

## Recovering an uncertain Connect disconnect

An `unknown` or stale `dispatched` operation stays denied. An HTTP rejection,
missing provider listing, or elapsed time cannot prove that the original DELETE
finished. Never retry that DELETE or clear its fence to permit reconnect.

Recovery is internal-only and needs a separately approved exact operation:

1. Preserve the fence, trigger-consent row and provider request evidence in the
   encrypted Mac/R2 backup. Read the target's runtime pins without logging its key.
2. Run `workosDisconnectRecovery:inspect` against the explicit deployment with
   `fenceId`, `cloudUrl`, `siteUrl`, `environmentId`, `authKitClientId`,
   `authKitDomain` and `credentialFingerprint` (SHA-256 of the API key).
   Stop if inspection returns null or any target differs.
3. Obtain positive evidence for the original request: a preserved successful
   204, or written provider confirmation that deletion completed and no original
   request remains pending. Record its private reference and original request ID.
   The operator must review this evidence; the recovery API validates an
   attestation, not the provider's evidence itself.
4. Prepare a private JSON proposal from the inspection output, omitting `state`.
   Retain every operation field and `snapshotDigest` unchanged. Add the separate
   `approvalReference` and `evidence` containing `kind` (`preserved-204` or
   `provider-written-confirmation`), `reference`, `originalRequestId`,
   `originalDeletionCompleted: true` and `noPendingOriginalRequest: true`.
   Obtain human approval for this proposal before executing it.
5. Run `workosDisconnectRecovery:recover` with that exact proposal and explicit
   deployment selector. It sends no provider requests. It records the receipt on
   the fence and permanent consent tombstone, denies all recorded sibling grants,
   and retains the 305-second reconnect fence. A 503 is not completion; resume
   only the identical approved operation. Changed pins, generation, evidence or
   snapshot require a new inspection and decision.
6. Verify the matching operation is completed, its permanent receipt is retained,
   old grants remain denied and reconnect succeeds only after the fence expires.
   Preserve the result in the encrypted evidence checkpoint.

Deployment of these functions does not approve or execute recovery. No recovery
activation has been performed as part of this preparation.

## Approved development repair (6 October 2026)

The user separately approved the two exact social owner bindings and retirement
of two unowned test fixtures. A fresh encrypted dev snapshot/configuration passed
local decryption and private R2 GET checksum before writes. Both social mappings
now have real signed updated-event profiles, and both fixture deletions received
provider acknowledgements and signed deletion receipts. Audit settlement found
an invalid Convex ID lookup; the grouped fix retains complete bounded ownership
checks. Settlement and final verification passed: all 142 permanent owners and all
1,295 card-to-owner pairs are unchanged, with zero unresolved quarantine.
The original absent account-change pause setting was restored. The fresh
7 October preflight found six provider users and no collisions. No bulk user
import occurred.

## User-approved revisions

- Backups: this Mac plus a new private temporary R2 bucket, with credentials and
  the encryption key in separate Keychain entries, replace the two offline drives.
- Skip Electron, which is an unshipped reference workspace. Partial native sign-in
  evidence exists; expiry refresh and sign-out are not proven.
- Replace the physical iPhone readiness check with an iOS simulator check.
- Use dated encrypted full Mac/R2 snapshots plus manual Convex backups instead of
  unsupported R2 versioning and Pro-only Convex scheduling (approved by the user).
- Use the default WorkOS email domain instead of the paid custom domain.
- The shadow week, additional Mac/iOS/Electron/Raycast runtime checks and Mac/iOS
  release waiting and remaining isolated production-copy rehearsal were waived;
  those waivers are not runtime proof. Firefox is
  excluded because it is not published.

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

## Historical Phase R backup proof

Local source history, Convex dev/prod exports, explicit Better Auth models,
configuration, and all 4,093 production R2 card objects are encrypted.
The private temporary bucket contains checksum-verified encrypted copies.
All expected card files restored locally with matching SHA-256 and total size
(594,937,450 bytes). An anonymous local Convex backend restored all 84 data tables
and 74,100 documents with exact normalized document hashes, IDs, and creation times.
Authenticated ownership checks matched 835 and 200 exact card IDs for two accounts;
anonymous and cleared-auth reads were denied. This uses an isolated local JWT issuer,
so it does not prove canonical application sign-in. The remaining Phase 4
rehearsal was subsequently waived by the user on 6 October.

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

Phase R passed before the Phase 0 production freeze. Phase 0 backend/web code is
deployed; the production auth provider is still Better Auth. No production WorkOS
cutover or identity backfill has occurred.
Card ownership is immutable. Better Auth remains intact until Phase 6.
The shadow week was waived by the user. Store-release lead time, notice, rollback
window and stable weeks remain required; passing a build does not satisfy those
time gates.

## Historical Phase 0 preparation

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
and manual Convex backups. The preparation copies below were subsequently replaced
by the full post-freeze backup and canonical restore proof in `phase-0.md`.

The completed Phase 0 record in `phase-0.md` supersedes these preparation counts.
Its canonical restore verifies password sign-in, all 831 exact active card IDs,
WebSocket access, live revocation, and the Chrome card grid. The latest encrypted
Mac/R2 checkpoint `readiness-checkpoint-1791041210.tar.gpg` preserves that evidence;
local decryption and streamed remote SHA-256 verification passed.

Production scheduled backups require Convex Pro and are currently Never; the user
approved the manual-backup replacement. Billing is unchanged.
