# Phase 0 rollout record

## Preconditions

- Phase R capability results and approved exceptions are in `readiness.md`.
- The user approved dated encrypted Mac/R2 snapshots plus manual Convex backups
  as the backup replacement. R2 object versioning is unsupported; Convex scheduling
  requires Pro. Neither limitation requires a billing change with this revision.
- Production continues to use Better Auth with sign-ups open.
- Do not progress to Phase 1 backfills until the freeze and full backup pass.

## Prepared behavior

`SIGNUPS_DISABLED=true` closes email registration, implicit Google/Apple creation,
and native/provider creation through the database hook. The configured `e2e-*`
accounts retain the internal provisioning exception. Existing sign-ins, password
resets, verification, account linking, and deletion remain available.

`auth.getAuthMode` reports the actual Better Auth primary and the pause state.
Registration screens subscribe through the cached Convex hooks. Web registration
and mobile sign-up/welcome hide creation actions. Social failures and browser
callback `signup_disabled` show the same pause message.

`migration/exportBetterAuth:page` is internal and exports one bounded page of one
of the eight approved models. Continue with its returned cursor until `isDone`.
Encrypt all output immediately; account/session/OAuth rows contain credentials.
Never print their values, commit them, or upload unencrypted copies.
This paged live export is a supplementary inventory: writes between pages can
change its contents. The coherent Convex snapshot, including Better Auth component
tables, is the authoritative restore source. Generate the final model inventory
from that isolated restored snapshot and reconcile it with the live export before
proceeding; never combine live pages into a claimed point-in-time backup.

## Dev evidence

- 1,851 backend unit tests, 148 backend edge integration tests, 194 web tests,
  178 mobile tests, and 41 targeted error-copy tests passed.
- Web, mobile, shared UI, and backend typechecks passed; the production web build passed.
- Environment audit and web doctor passed; the existing mobile
  `APPLE_API_KEY_PATH` warning remains.
- Real Chrome: freeze hides registration actions, keeps the return path, and
  an existing Google account signs in with its 201 cards still available.
- Removing the flag restores registration on the same open page without reload.
- Freeze-hook inversion and truncated export pages caused the corresponding
  behavior tests to fail; implementations restored afterward.
- Auth-config regression tests reproduce Convex's unset-variable failure and
  verify production/local deployments need no WorkOS configuration. Readiness
  identity/metadata gates and the actual WorkOS registration mutation have
  regression coverage. Removing the identity gate or freeze enforcement makes
  the relevant tests fail; implementations restored afterward.
- Canonical iOS UI check skipped by explicit user request; build stopped.
  Earlier Phase R simulator PKCE/refresh/sign-out proof remains available.
- The initial rehearsal restored the dev flag unset; after backup approval the dev
  freeze was enabled for Phase 0. A signed WorkOS Action test denied registration
  with the canonical pause message. Production remains unchanged.

## Remaining rollout

1. Verify the preserved encrypted backup copies before rollout.
2. Review the complete Phase 0 diff and rerun required release checks.
3. Release 1.0.76 deploys the inert backend and web pause support to production,
   with the production flag off. Lockstep release preparation passed.
4. Enable the dev freeze, verify existing sign-ins and creation rejection, then
   enable the production freeze and verify the same behavior there.
5. Immediately export fresh dev/prod Convex snapshots including file storage and
   all eight Better Auth models. Preserve full R2 card objects separately.
6. Record counts and hashes, encrypt, keep the Mac copy, and stream-verify the
   separate private R2 copy. Preserve every earlier snapshot.
7. Restore into an isolated deployment with no production service credentials or
   scheduled application jobs. Verify manifests and canonical sign-in/card ownership.
8. Create and record a manual Convex production backup as the short-term second
   layer. The approved replacement uses dated encrypted Mac/R2 snapshots plus
   manual Convex backups; Pro-only scheduling remains disabled.
9. Record the frozen user counts, completed restore evidence, and snapshot IDs before
   starting Phase 1. A prepared guard or database-only restore does not satisfy this gate.

## Additional preparation evidence

The dev export runner explicitly targets `reminiscent-kangaroo-59`, rejects duplicate
IDs and stalled cursors, and keeps plaintext in memory. It exported all eight models
and verified the encrypted file through decryption. This is a preparation copy with
sign-ups open, not the required post-freeze backup. The separate proof records
142 users, 158 accounts, 388 sessions, 14 verifications, 9 OAuth applications,
22 OAuth tokens, 16 consents, and one JWKS row.

Production `SIGNUPS_DISABLED` is confirmed unset. Its backup settings show Never,
Pro-only scheduling, and no existing dashboard backups. No billing or backup settings
were changed. Keep the encrypted migration snapshots regardless of the dashboard layer.
