# WorkOS migration record

Production moved from Better Auth to WorkOS AuthKit on 7 October 2026, and
sign-ups reopened the same day. The cutover, import and rollback tooling was
removed after the cutover: rollback cannot succeed once WorkOS-only accounts
exist. The full phase plans and evidence are in git history before this file.

## Retained data and backups

- On 31 October 2026, with the owner's approval, the retained Better Auth data
  was deleted from the production and dev deployments and the component was
  unmounted. No Better Auth code or package remains.
- The data now exists only in encrypted local backups. The latest and complete
  one is
  `/Users/praveenjuge/Documents/TeakMigrationBackups/2026-10-31-before-unmount`
  (every model with rows, checked against production's row counts before the
  delete). The older set from the cutover, `2026-10-03-phase-r`, is beside it.
  The R2 copy no longer exists.
- Deleting either local backup needs explicit owner approval.

## Connect disconnects

Disconnecting an app deletes its grant at WorkOS, then marks every consent Teak
has seen for that app as revoked; those tokens are denied at once. A token from
a consent Teak hasn't seen stops working when it expires, within 15 minutes.
If WorkOS can't be reached, nothing changes and the user can retry.

A disconnect left `unknown` or `dispatched` by the previous flow still denies
that app. The user's next successful disconnect proves the grant is gone and
marks it completed. No manual recovery is needed.
