# Phase 0 rollout record

## Preconditions

- Phase R capability results and approved exceptions are in `readiness.md`.
- The user approved dated encrypted Mac/R2 snapshots plus manual Convex backups
  as the backup replacement. R2 object versioning is unsupported; Convex scheduling
  requires Pro. Neither limitation requires a billing change with this revision.
- Development and production continue to use Better Auth with sign-ups frozen.
- Do not progress to Phase 1 backfills until the freeze and full backup pass.

## Shipped behavior

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
  with the canonical pause message. This preceded the production rollout below.

## Completed rollout: 2026-10-03

- PR #482 merged as `6786b9aad3c3235a5f0005cd143906257cadad02`.
  Backend Deploy and the Vercel web deployment succeeded; both environments report
  Better Auth primary, sign-ups disabled, and account changes available.
- Production Chrome registration displays the pause. Email registration rejects
  with `EMAIL_PASSWORD_SIGN_UP_DISABLED`; the existing Google account still has
  its 831 active cards. Provider/native freeze paths have SDK integration coverage.
- Full post-freeze Convex exports include component tables and file storage.
  The production snapshot contains 73,944 documents across 50 nonempty data tables.
  Every Better Auth model was inventoried from the coherent snapshot; paged live
  inventories remain supplementary. Their user rows match exactly; one live
  session and Google token updates explain the observed live-export differences.
- Fresh card-file backup: 4,095 objects, 594,941,047 bytes. Encryption, decryption,
  every restored object checksum, and the separate R2 archive checksum passed.
- Dated encrypted Mac and private R2 copies retain all snapshots. The key is
  stored separately in Keychain. Manual Convex backups `1791035102996` and
  `1791036477219` completed with file storage; their retention is seven days.
- The isolated restore exactly matches every source document ID, creation time,
  and value before test fixtures. It has no production service credentials or
  restored scheduled jobs. Original snapshot signing keys remain preserved;
  a new local signing key avoids binding the production auth secret.
- The user authorized a temporary password only on their isolated restored
  account. Canonical password sign-in, JWT exchange, all 831 exact active card IDs,
  ownership, real WebSocket subscription, sign-out, and cached-JWT denial passed.
  Chrome also signed in and rendered the restored card grid. The test exposed a
  local CSP omission; configured development loopback HTTP/WS origins now work.
- Billing and API-key components were deliberately inert in the isolated restore;
  this gate proves restored auth/cards, not those component interfaces.
- Release 1.0.76 CLI and extension workflows succeeded. iOS and Mac packages
  processed successfully and are awaiting App Store review, not live in stores.

Snapshot Better Auth model counts:

| Model | Dev | Production |
| --- | ---: | ---: |
| user | 142 | 283 |
| account | 158 | 286 |
| session | 388 | 314 |
| verification | 14 | 1 |
| oauthApplication | 9 | 103 |
| oauthAccessToken | 22 | 52 |
| oauthConsent | 16 | 61 |
| jwks | 1 | 1 |

Private proofs and manifests live in the approved Mac backup folder and encrypted
R2 checkpoints. No sensitive dumps or credentials are committed. Phase 0's restore
and backup gate passed; Phase 1 must retain Better Auth and all existing ownership.

## Additional preparation evidence

The dev export runner explicitly targets `reminiscent-kangaroo-59`, rejects duplicate
IDs and stalled cursors, and keeps plaintext in memory. It exported all eight models
and verified the encrypted file through decryption. This is a preparation copy with
sign-ups open, not the required post-freeze backup. The separate proof records
142 users, 158 accounts, 388 sessions, 14 verifications, 9 OAuth applications,
22 OAuth tokens, 16 consents, and one JWKS row.

Before rollout, production sign-ups were open and manual backups had not been
created. The completed rollout above supersedes that preparation state. Scheduled
backups remain Never under the approved manual replacement.
