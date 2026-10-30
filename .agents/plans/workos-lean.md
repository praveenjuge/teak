# Lean WorkOS

Production has run on WorkOS AuthKit alone since 7 October 2026. The
cutover left defences that only mattered while two providers and imported
accounts coexisted. This plan removes them in five phases, each its own PR,
so that sign-in, sync, deletion and Connect each have one obvious path.

Out of scope: the retained Better Auth data (component mount,
`legacyBetterAuth.ts`, `migration/exportBetterAuth.ts`, the packages). It
waits for the retention period and owner approval in
`migrations/workos/README.md`, unchanged.

## Facts this plan relies on

Check these against the code before starting a phase; they were true when
the plan was written.

- `@convex-dev/workos-authkit` 0.2.10 stores users in its own `users` table,
  skips duplicate event IDs, keeps a `deletedUsers` tombstone so a late
  `user.created`/`user.updated` is ignored, and inserts an update that arrives
  before its create. `authKit.events({...})` runs a handler in the same
  mutation, only when the component actually changed a row.
- The component dropped its Events API code in 0.2.9/0.2.10 and is webhook
  only. WorkOS recommends the Events API for keeping data in sync, so Teak's
  hourly catch-up (`workosEventCatchUp.ts`) stays.
- The component's own `registerRoutes` verifies `JSON.parse(payload)`
  (re-serialized, not the raw body) and answers a missing signature with a
  500. Teak's own routes in `workosWebhook.ts` are justified and stay.
- 0.2.10 skips the event hook for `user.deleted` when it never stored the
  user; 0.3.0 fixes that.
- Teak's JWT template puts `email` and `email_verified` in every session
  token (`self-hosting.mdx`, step 3; `packages/tests/src/stack/config.ts`).
- Teak never sets `externalId` on a WorkOS user. Only accounts imported from
  Better Auth carry one, and each of them is also linked by
  `users.workosUserId`.
- Released Apple and Android builds read `ensureUser`'s
  `{ status: "quarantined", reason: "profile_pending" }` and retry on it; the
  web boundary does the same. The validator must keep that shape.
- Published `teak-sdk`/CLI builds read `primary: "workos"` from the OAuth
  clients document (`publicApi/http/meta.ts`).
- WorkOS has no consent or authorized-app events and no revocation endpoint,
  so `workosConsents` (Teak's own revocation list for the five-minute token
  window) and the raw Management API calls in `workos/authorizedApps.ts` stay.

## What each request costs today

`getSessionUser` → `resolveOwner` reads a `migrationQuarantine` deletion
receipt, `users` by `workosUserId`, `accountDeletionStates`, `users` by
`teakUserId` again (duplicate check), and the component's user, then compares
`externalId` three ways. Every authenticated query and mutation pays for
this. After phases 1, 2 and 4 it reads `users` by `workosUserId` and
`accountDeletionStates`, plus the component profile for Connect tokens only.

## Phase 1: drop `externalId` and the second identity check (convex)

Goal: one identity rule. A WorkOS user ID maps to exactly one `users` row,
and that row decides.

- Remove `externalId` from `resolveOwner`/`resolveWorkosOwner`
  (`workosIdentity.ts`), `ensureUser` (`workosBootstrap.ts`),
  `linkWorkosUser` (`workosUsers.ts`), `parseWorkosEvent`
  (`workosLifecycle.ts`), `authorizeConnectConsent` (`workosConsents.ts`),
  `check` and the principal validator (`workosApplicationDisconnect.ts`),
  `readWorkosSessionClaims`/`getDeletionRetryPrincipal`
  (`securitySessions.ts`), and the token principal and
  `validWorkosExternalId` (`workos/tokens.ts`).
- Drop the `external_id_mismatch` and `duplicate_mapping` denial reasons from
  the resolver. Keep the reason strings readable in `authMonitoring.ts` so
  older logs still parse.
- `resolveStoredUserId` (used by Workers and API keys) stops round-tripping
  through `resolveOwner` with `externalId: ownerId`; it reads the row and
  applies the same deleted/deleting checks.
- Docs: drop `external_id` from the JWT template in `self-hosting.mdx` and
  the matching text. Leaving the claim in Teak's own template is harmless;
  removing it there is a dashboard change for the owner.

Verification: `edge/workosIdentity`, `workosBootstrap`, `workosBearer`,
`workosConsents`, `workosSessions` tests updated; their `externalId` cases
deleted. `verify-teak`: sign in on web, call `/v1/me` with an API key and
with a Connect token, connect MCP.

## Phase 2: sign-in creates the account from the token (convex, web)

Goal: no "profile pending" wait, no Events API replay at sign-in, one
bootstrap path.

- `ensureUser` creates the owner from the verified session claims (`sub`,
  `email`, `email_verified`) instead of waiting for the component's copy of
  the profile. The signed token is the same evidence the webhook profile was.
  It still refuses unverified email and paused sign-ups, and a WorkOS user
  with a deletion tombstone (phase 4): an access token stays valid for a few
  minutes after `user.deleted`, and the component's own `deletedUsers` table
  has no query Teak can call.
- Delete `ensureUserNow`, `replayRecentProfileEvents`, the
  `workosProfileReplays` rate limit, and their tests
  (`edge/workosBootstrapNow.test.ts`). Keep `profile_pending` in the result
  validator, never returned, for released mobile builds; add a `sunset.md`
  row.
- Web: delete `workos-callback-bootstrap.ts` and its call in
  `app/callback/route.ts`; `WorkosAuthBoundary` calls `ensureUser` once and
  loses `PENDING_PROFILE_RETRY_MS`. Point Apple and Android at the same
  single call in their next releases (their retry loop just stops firing).
- `syncOwnerEmail` (email change from WorkOS) and the `user.created` link
  stay in the webhook path, so an account created on the token and one
  created by the webhook converge on the same row (both go through
  `linkWorkosUser`, which is idempotent on `workosUserId`).

Verification: sign up a fresh account on the local stack with the webhook
delayed (emulator) and confirm the vault opens on the first try; sign in on
the Apple and Android simulators against the dev deployment if reachable,
otherwise say so in the PR.

## Phase 3: lean event validation (convex)

Done: `parseWorkosEvent` checks only what Teak uses (IDs, the event time,
the address and its verification); the component validates the profile it
stores. The route and the catch-up cron already share `ingestWorkosEvent`.

Left for later: moving Teak's handler into the component's `events()` hook.
On 0.2.10 the hook skips `user.deleted` for a user the component never
stored, so Teak would keep a second deletion path next to it. Revisit with
`@convex-dev/workos-authkit` 0.3.0 (published 28 October 2026) once it has
aged in other deployments.

## Phase 4: deletion without receipts and environment fingerprints (convex)

Goal: deleting an account marks the row deleted and deletes the WorkOS user;
nothing else proves it.

- `users.workosDeletedAt` (set from `user.deleted`) keeps a mapped deleted
  user out, so the per-request resolver stops reading deletion receipts.
- A `user.deleted` for a WorkOS user with no owner row yet still needs a
  tombstone Teak can read, or `ensureUser` could create an owner from a token
  issued before the deletion (`edge/workosLifecycle.test.ts`,
  "delete-before-create"; `edge/workosBootstrap.test.ts`, "unmapped"). Keep
  writing the `workos_user_deleted` row and `hasWorkosDeletionReceipt`, read
  only when creating an owner. Move it to a small `workosDeletedUsers` table
  in the later schema PR.
- Delete what only proved a receipt resolved:
  `expectedWorkosDeletionResolution`, the receipt-resolution loop in
  `accountDeletionJobs.ts` (`deletionReceiptCursor`), and the
  `workosDeletionTarget` on receipts.
- Drop the WorkOS "deletion target" (`environmentId`, `clientId`, `issuer`,
  `credentialFingerprint` of the API key) in `workos/deletionCompletion.ts`,
  `accountDeletion.ts` and `accountDeletionActions.ts`. It guarded against a
  deletion started under one WorkOS environment finishing under another
  during the cutover; there is one environment per deployment now.
  `workosUser` stage calls `deleteUser` with the current client and treats
  404 as done.
- Stop writing `users.workosDeletionCompletion`,
  `accountDeletionStates.workosTarget` and `deletionReceiptCursor`. The
  fields stay in the schema (optional) with `sunset.md` rows until a backfill
  unsets them (needs owner approval).
- Stop writing `migrationQuarantine` from linking (`email_unverified`,
  `signups_frozen`, `profile_pending`): the client already gets that answer.
  Deletion tombstones are then its only writer; the admin Operations card
  drops its quarantine summary, and the table becomes the tombstone table in
  the later schema PR.

Verification: `edge/workosDeletionCompletion.test.ts` mostly deleted;
`accountDeletionWorkflow` and `workosLifecycle` tests cover delete from
Settings, a `user.deleted` from the WorkOS dashboard, a late
`user.updated` after deletion, and `ensureUser` refusing a token for a user
deleted before they had an owner. `verify-teak`: delete the seeded account on
the local stack and confirm sign-in is refused.

## Phase 5: web, clients, admin and docs leftovers

Each item is small; group them by reviewer.

- Web: delete `workosCallbackState`/`assertWorkosCallbackBinding`
  (`workos-config.ts`, `workos-auth-start.ts`, `app/callback/route.ts`).
  AuthKit already seals and checks the PKCE state, and the code exchange
  fails for another client. Drop the custom `WORKOS_ISSUER` comparison and
  32-character cookie check that AuthKit does itself (and their copies in
  `scripts/validate-env.ts` and `env-contract-entries-surfaces.ts`).
- Web: merge the three sign-in route sets (`proxy.ts`, `auth-entry.ts`,
  `safe-next-path.ts`) into one constant; drop the unused `"recovery"` flow.
  Remove `/forgot-password` and `/reset-password` (Better Auth email links).
  `/login` and `/register` go only after sign-out returns to `/sign-in`: that
  needs the WorkOS logout redirect changed in each environment (owner, in the
  dashboard or with the WorkOS CLI), `self-hosting.mdx` steps updated, and
  the e2e helpers moved (`packages/tests/src/helpers/app.ts`,
  `web/sign-in-entry.e2e.ts`, `docs/extra-prod-surfaces.e2e.ts`).
- Admin: drop `countLegacyBetterAuthUsers` from `admin:getOperations` (up to
  40 component pages on every load for a number that no longer changes;
  record the final count in `migrations/workos/README.md`), and the
  `"legacy"` sign-in provider label in `adminUsers.ts` once every live row
  has `workosUserId`.
- CLI: delete the unreachable `DEFAULT_AUTH_URL` (the old Better Auth
  issuer) in `apps/cli/src/runtime.ts`.
- Sunset list: add rows for what has to wait for released clients, and remove
  them on their own schedule, not in this plan: discovery `primary`
  (`publicApi/http/meta.ts`, `packages/sdk/src/authDiscovery.ts`),
  `isWorkosCredential` and unbound credentials in the SDK, CLI and extension,
  and CLI credentials without `ownerId`.
- Docs: drop the time-bound "October 7, 2026 sign-in update" text in
  `(developers)/mcp.mdx` and its eval in `apps/docs/evals.yaml`, and the
  `SIGNUPS_DISABLED` upgrade note in `self-hosting.mdx`.
- Tests: drop Better Auth fixtures that only test the leftovers above
  (`better-auth.session_token` in `authRoutes.test.ts`, the `primary:
  "workos"` state case in `workosWebConfig.test.ts`).
- Optional: seal the test session with `authenticateWithPassword({ session:
  { sealSession: true, cookiePassword } })` in
  `scripts/lib/workos-test-session.ts` instead of `sealData` by hand, after
  checking AuthKit accepts the cookie.

## Kept on purpose

- Teak's own `/workos/webhook` and `/workos/action` routes (raw-body
  verification), the hourly Events API catch-up, and dead letters.
- `users` as the app's own table keyed by `workosUserId`, as the component's
  README recommends; profile fields are read from the component, not copied.
- `workosConsents` and the Connect disconnect flow; the raw authorized-apps
  calls (no SDK method).
- `auth.config.ts` with the one `user_management/<clientId>` issuer and the
  emulator base for local backends.
- `workosApplicationDisconnects` and `recoveryReceipt` until their rows
  complete (already in `sunset.md`).
- Defensive web code that isn't migration-specific (`WorkosAuthBoundary`
  identity-change guards, `session-token.ts` retries). They can be reviewed
  separately; this plan doesn't depend on them.

## Expected result

About 15 backend files shrink or go: `workosBootstrap.ts` loses the Events
replay, `workosLifecycle.ts` most of its validation,
`workos/deletionCompletion.ts` shrinks to the tombstone check,
`workosProfileRead.ts` disappears, and
`workosUsers.ts`/`workosIdentity.ts` roughly halve. Roughly 2,000 lines of
WorkOS edge tests go with them. Each request does two indexed reads for
identity instead of five plus a component call.

## Owner decisions before starting

1. Phase 2 trusts the session token's `email`/`email_verified` to create an
   account. Accept that, or keep waiting for the webhook profile.
2. Phase 4 drops the environment fingerprint on account deletion. Accept, or
   keep it as a cheap guard.
3. Phase 5 needs the WorkOS sign-out redirect changed to `/sign-in` in each
   environment before `/login` can go.
4. Unsetting the stopped fields and replacing `migrationQuarantine` with a
   tombstone table are schema changes and need explicit approval when their
   time comes.
