# WorkOS migration record

Production moved from Better Auth to WorkOS AuthKit on 7 October 2026, and
sign-ups reopened the same day. The cutover, import and rollback tooling was
removed after the cutover: rollback cannot succeed once WorkOS-only accounts
exist. The full phase plans and evidence are in git history before this file.

## Retained data and backups

- The Better Auth Convex component stays mounted only for retained data. No
  Better Auth runtime code remains: no client, triggers or sign-in. Its only
  uses are account deletion cleanup (`packages/convex/legacyBetterAuth.ts`,
  which removes a legacy owner's rows; finalization redacts the owner's
  address) and the backup exporter
  (`packages/convex/migration/exportBetterAuth.ts`, nine models including
  `twoFactor`). `@convex-dev/better-auth` and its `better-auth` peer stay
  installed for the mount.
- Removing the retained Better Auth data, unmounting the component, or deleting
  customer data needs separate explicit owner approval.
- Encrypted local evidence: `/Users/praveenjuge/Documents/TeakMigrationBackups/2026-10-03-phase-r`.
- Encrypted remote copy: private R2 bucket `teak-workos-migration-backup-20261003`
  (APAC Standard). The approved migration plan is in it as `approved-plan.txt.gpg`.
- Never remove either copy before the approved retention period.

## Connect disconnects

Disconnecting an app deletes its grant at WorkOS, then marks every consent Teak
has seen for that app as revoked; those tokens are denied at once. A token from
a consent Teak hasn't seen stops working when it expires, within five minutes.
If WorkOS can't be reached, nothing changes and the user can retry.

A disconnect left `unknown` or `dispatched` by the previous flow still denies
that app. The user's next successful disconnect proves the grant is gone and
marks it completed. No manual recovery is needed.
