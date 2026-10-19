## Goal

Make Teak's WorkOS integration smaller and closer to what WorkOS and its SDKs
now provide, without weakening sign-in, Connect revocation or account deletion.
Each phase below ships as its own PR. Delete this plan in the PR that finishes
the last phase.

## Context And Current Facts

Checked on 16 October 2026 against WorkOS's docs, changelog and blog, and the
installed packages. Check them again before starting a phase.

- Versions:
  - `@workos-inc/node` 10.14.0 (latest is 11.0.0; it breaks only Pipes).
  - `@workos-inc/authkit-nextjs` 4.4.0 (latest). Its peer range is
    `@workos-inc/node ^9 || ^10`, so Node SDK 11 waits for it.
  - `@convex-dev/workos-authkit` 0.2.10 (latest).
  - `@workos/emulate` 0.14.0 (0.15.0 shipped 15 October 2026).
- The Node SDK still has no method for a user's authorized applications.
  `workosAuthorizedApps.ts` calls the API by hand on purpose: redirects are
  rejected, bodies are capped and IDs are validated. The SDK's generic
  `workos.get`/`workos.delete` would drop those guards, so keep it.
- The SDK has no verifier for Connect access tokens (AuthKit-domain issuer,
  `/oauth2/jwks`), so `workosTokens.ts` stays on `jose`.
- WorkOS has no "get session by ID" endpoint. `revokeAuthkitSession` pages
  `listSessions` to prove ownership before revoking, which is the only way.
- WorkOS does not document whether `deleteUser` also revokes sessions and
  Connect grants. Account deletion keeps its explicit `providerSessions` and
  `authorizedApps` stages until that is proven (phase 5).
- The native apps already treat only `invalid_grant`, `invalid_refresh_token`
  or a 401 as terminal on refresh, as WorkOS's session-resilience guide asks.
- The `safari` key in `/.well-known/teak-oauth-clients.json` is still read by
  published `teak-sdk` versions (see `publicApiMeta.ts`). The native Apple
  plan decides when it goes.

## Phases

### 1. Dashboard and config hygiene (owner, no code)

- MCP spec 2026-07-28 deprecates dynamic client registration in favour of
  CIMD. The setup docs turn both on. Watch which MCP clients still register
  through DCR, and turn DCR off once none need it. The E2E consent helper
  (`packages/tests/src/helpers/workos-consent.ts`) registers through DCR because
  the emulator doesn't support CIMD; keep it until the emulator does.
- `appHomepageUrl` in `packages/convex/convex.json` is WorkOS's deprecated "App
  homepage URL". The setup docs already set a default Sign-out URI
  (`<origin>/login`). Confirm Convex's `authKit.configure` can drop the field,
  then remove it from both environments and from the docs.
- WorkOS accepts `http://localhost:*/callback` as a redirect URI. Replace the
  40 per-port entries in `authKit.dev.redirectUris` with
  `http://localhost:3000/callback` (the default, which can't be a wildcard) plus
  the wildcard, once a `bunx convex dev` push confirms Convex applies it. CORS
  origins can't use wildcards, so that list stays.
- Update the vendored skill (`npx skills add workos/skills -s workos -a codex
  -y`). The locked copy is stale: it says there is no `workos.radar` namespace,
  still lists `WORKOS_NO_PROMPT` and `refreshAndSealSessionData`, and has
  nothing on Connect, CIMD, resource indicators, Actions or step-up auth.

### 2. One user ledger: the component's

The AuthKit component already deduplicates events (`events`), ignores stale
updates and blocks a deleted user from coming back (`deletedUsers`), in the
same transaction as Teak's `applyWorkosEvent`. Teak keeps a second ledger,
`workosEvents`, mainly to answer "was this user deleted at WorkOS?".

- Answer that from `users.workosDeletedAt` and the component instead:
  `workosIdentity.ts` `resolve`, `workosProfileRead.ts`
  `readCanonicalWorkosProfile` and `workosUsers.ts`.
- Keep the deletion receipt (`migrationQuarantine` `workos_user_deleted`).
  It is what account deletion settles.
- Then stop writing `workosEvents` and drop the table. That deletes data in
  production, so it needs explicit approval from the owner.
- Watch for: the resolver's denial reasons are logged. A user deleted at WorkOS
  before they were ever linked would read `missing_mapping` instead of
  `workos_deleted_user`. Keep the denial; decide whether the reason matters.

### 3. Shrink linking now that the migration is over

`linkWorkosUser` (`workosUsers.ts`) still carries the cutover's reconciliation:
12 quarantine reasons, including `equal_timestamp_conflict`,
`duplicate_mapping` and `link_conflict`. Production has been WorkOS-only since
7 October 2026.

- Count open `migrationQuarantine` rows by reason in production first.
- Cut linking down to: link by `workosUserId`, else create when sign-ups are
  open and the email is verified, else quarantine as `signups_frozen` or
  `verify_email`.
- Consider setting each WorkOS user's `externalId` to its `teakUserId`
  (`updateUser`). Ownership could then use the component's
  `getAuthUserByExternalId` index, and the JWT template's `external_id` check
  would cover every account, not only migrated ones.

### 4. Webhook delivery: keep two layers, not four

Today a user event can arrive through WorkOS's own retries (6 times over 3 days
in production), the Files Worker queue with its own retries and dead-letter
queue (`apps/files-worker/src/queues/workosEvents.ts`), Convex's dead-letter
table (`workosWebhookDeadLetters`), and the hourly Events API catch-up
(`workosEventCatchUp.ts`). WorkOS calls the Events API the more robust of its
two delivery paths.

- Decide what the Files Worker buffer protects against that WorkOS's retries
  plus the hourly catch-up don't. If nothing, send the webhook straight to
  Convex again and remove the queue, its DLQ and `workosWebhookDeadLetters`
  (the table drop needs owner approval).
- Either way, save the catch-up cursor once per page instead of once per
  event.

### 5. Prove what `deleteUser` cascades

- In staging, create a user with an active session and a Connect grant, call
  `deleteUser`, then list both. If both are gone, remove the `providerSessions`
  and `authorizedApps` stages and `providerSessionCursor` from account
  deletion. Otherwise keep them and record the result here.

### 6. Native apps on the official SDKs

- Apple: WorkOS shipped an iOS SDK (`workos-ios`, August 2026) with a public
  PKCE client. Today `TeakCore/Auth` hand-writes the authorize URL, PKCE, the
  `/user_management/authenticate` calls and refresh (about 800 lines). Try the
  SDK behind the existing `TeakSession` interface. Keep the cross-process lock
  and the shared keychain; the extensions depend on them.
- Android: `WorkOsAuthApi.kt` posts `/user_management/authenticate` by hand
  because `workos-android` 0.4.0 always sends `client_secret`. Check whether a
  newer release fixes that for public clients, and delete the hand-written
  calls if it does.
- Consider a separate WorkOS Application for the native apps (Multiple
  Applications, March 2026), so they can have their own session lifetime.

### 7. Step-up before account deletion

WorkOS recommends a fresh sign-in (`auth_time`, `max_age=0`) before sensitive
actions. Web already supports `?reauth` (`maxAge: 0`). Make
`deleteMyAccount` require a recent `auth_time` on web first. Native app
versions already in use can't reauthenticate yet, so ship the native prompt
before enforcing it there.

### 8. Not adopting, and why

- WorkOS Widgets for sessions: `UserSessions` needs an organization role
  (`widgets:users-table:manage`), and Teak has no organizations. `UserProfile`
  and `UserSecurity` could add password, MFA and passkey management later. That
  is a feature decision, not a cleanup, and it needs a CSP change for
  `api.workos.com`.
- WorkOS API keys: user keys require an organization membership. Teak's keys
  (`@vllnt/convex-api-keys`) stay.
- Device authorization for the CLI: the loopback PKCE flow works, and WorkOS
  itself warns about device-code phishing.
- Moving Connected apps to a live `authorized_applications` list: the local
  `workosConsents` rows are also the revocation deny-list and show last use.

## Verification

Each phase runs `bun run verify` and the auth E2E specs
(`packages/tests/src/auth-runtime`, `journey/06-security`,
`journey/07-account-lifecycle`) against the emulator. Phases 2 to 5 also check
the behavior in staging before production.
