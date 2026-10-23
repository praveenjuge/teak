## Goal

Make Teak's WorkOS integration smaller and closer to what WorkOS and its SDKs
now provide, without weakening sign-in, Connect revocation or account deletion.
Delete this plan in the PR that finishes the last open item.

## Context And Current Facts

Rechecked on 23 October 2026 against WorkOS's docs, changelog and blog, the
installed packages and npm. Check them again before starting an item.

- Versions:
  - `@workos-inc/node` 10.14.0 (latest 11.0.0; it breaks only Pipes:
    nullable `DataIntegration.credentials` and discriminated credential unions).
  - `@workos-inc/authkit-nextjs` 4.4.0 (latest 4.5.0). 4.5.0 adds keyless PKCE
    public-client mode, enforces `WORKOS_ISSUER` against the session token's
    `iss` in every flow (the callback now runs `jwtVerify`), and recovers `sid`
    on sign-out. Its peer range is still `@workos-inc/node ^9 || ^10`, so Node
    SDK 11 still waits for it. Check the issuer setting before upgrading.
  - `@convex-dev/workos-authkit` 0.2.10 (latest).
  - `@workos/emulate` 0.14.0 (latest 0.16.0). 0.15.0 is breaking: it serves the
    AuthKit OAuth server for MCP (discovery, DCR, authorize, token, RFC 8707
    resource indicators). Its README still says CIMD is not implemented.
- The Node SDK still has no method for a user's authorized applications (the
  REST endpoints exist). `workos/authorizedApps.ts` calls the API by hand on
  purpose: redirects are rejected, bodies are capped and IDs are validated.
- The SDK has no verifier for Connect access tokens (AuthKit-domain issuer,
  `/oauth2/jwks`); WorkOS's MCP guide says to verify with `jose`, so
  `workos/tokens.ts` stays.
- WorkOS has no "get session by ID" endpoint. `revokeAuthkitSession` pages
  `listSessions` to prove ownership before revoking, which is the only way.
- WorkOS still does not document whether `deleteUser` also revokes sessions and
  Connect grants. Account deletion keeps its explicit `providerSessions` and
  `authorizedApps` stages until that is proven (item 5).
- AuthKit access tokens carry `auth_time`, which advances only on an active
  sign-in, never on refresh (WorkOS reauthentication guide).
- Web and the native apps sign in with the same WorkOS client, so no token
  claim tells a web session from a native one.
- The native apps already treat only `invalid_grant`, `invalid_refresh_token`
  or a 401 as terminal on refresh, as WorkOS's session-resilience guide asks.
- The `safari` key in `/.well-known/teak-oauth-clients.json` is still read by
  published `teak-sdk` versions (see `publicApi/http/meta.ts`). The native Apple
  plan decides when it goes.

## Done

- `authKit.dev.redirectUris` is `http://localhost:3000/callback` (the default,
  which can't be a wildcard), `http://localhost:*/callback` and the app scheme.
  A `convex dev` push added the wildcard to WorkOS staging.
- `appHomepageUrl` is gone from `convex.json` and the self-hosting docs. Convex
  treats it as optional and never clears the dashboard value.
- The vendored `workos` skill is current upstream.
- "Was this user deleted at WorkOS?" is answered from `users.workosDeletedAt`
  and the `workos_user_deleted` receipt (`hasWorkosDeletionReceipt`), which
  every applied `user.deleted` writes, even for a user Teak never linked. The
  resolver keeps the `workos_deleted_user` reason for that case. Nothing reads
  `workosEvents` for deletion any more.
- The Events API catch-up saves its cursor once per page, and keeps the
  progress before a failing event.

## Open

### 1. Dashboard hygiene (owner)

- Delete the 40 per-port `http://localhost:<port>/callback` redirect URIs from
  the WorkOS staging environment; the wildcard covers them. Then sign in from a
  worktree port to confirm the wildcard matches.
- Clear the deprecated "App homepage URL" in staging and production. Both
  already have a default Sign-out URI (`<origin>/login`).
- CIMD is off by default in WorkOS Connect; DCR stays for backwards
  compatibility with no removal date. Turn CIMD on, watch which MCP clients
  still register through DCR, and turn DCR off once none need it. The E2E
  consent helper (`packages/tests/src/helpers/workos-consent.ts`) registers
  through DCR because the emulator doesn't support CIMD; keep it until it does.

### 2. Drop `workosEvents` (owner approval)

`workosEvents` is now only the event dedup ledger: `applyWorkosEvent` skips an
event ID it has seen, and `recordUndeliverable` checks it before dead-lettering.
The component's own dedup can't replace it as wired, because Teak runs
`applyWorkosEvent` after the component whether or not the component skipped the
event. Its `onEventHandle` callback passes no event ID or `createdAt`, and the
deletion receipt needs the event time (`workosDeletionEventAt` is checked
against the deletion proof). To drop the table, first make `applyWorkosEvent`
idempotent without it: dedupe the deletion receipt on `(workosUserId,
workos_user_deleted)` and accept that replays of `user.created` re-run linking.
`recordUndeliverable` also reads it, so remove that (item 4) or replace its
lookup first. Dropping the table deletes production data and needs the owner's
approval.

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

A user event can arrive through WorkOS's own retries (6 times over 3 days in
production, a few minutes in staging), the Files Worker queue with its retries
and dead-letter queue (`apps/files-worker/src/queues/workosEvents.ts`),
Convex's dead-letter table (`workosWebhookDeadLetters`), and the hourly Events
API catch-up. WorkOS recommends the Events API over webhooks.

The Files Worker buffer adds little: Convex refuses a signature older than the
SDK's 3-minute tolerance, so the queue's retries only help within those 3
minutes, which WorkOS's own retries also cover; anything later is dead-lettered
and left to the catch-up. Removing it means pointing both WorkOS webhook
endpoints at `<convex-site>/workos/webhook` in the dashboard first, then
deleting the queue, its DLQ binding, `recordUndeliverable*` and, with owner
approval, `workosWebhookDeadLetters`.

### 5. Prove what `deleteUser` cascades

In staging, create a user with an active session and a Connect grant, call
`deleteUser`, then try to refresh both with tokens that worked just before.
Count a refresh as refused only on the terminal responses the native apps use
(`invalid_grant`, `invalid_refresh_token` or a 401); transient errors don't
count. If both are refused, remove the `providerSessions` and `authorizedApps`
stages and `providerSessionCursor` from account deletion. Otherwise keep them
and record each response here. Needs the staging API key, which agent sessions
can't use directly.

### 6. Native apps on the official SDKs

- Apple: `workos-ios` 0.8.0 (19 October 2026) has a `PublicClient` with PKCE,
  code exchange and refresh, and sends no API key or secret. Try it behind
  `TeakSession` in `TeakCore/Auth`. Keep the cross-process lock and the shared
  keychain; the extensions depend on them. Needs Xcode to build and test.
- Android: `workos-android` 0.4.0 is still the latest. Its `PublicClient` has no
  refresh, and `authenticateWithCode`/`authenticateWithRefreshToken` still send
  `client_secret` (empty for a public client), so `WorkOsAuthApi.kt` keeps its
  hand-written calls.
- Consider a separate WorkOS Application for the native apps (Multiple
  Applications, March 2026). It gives them their own session lifetime and a
  distinct client ID, which item 7 needs.

### 7. Step-up before account deletion

WorkOS recommends a fresh sign-in (`auth_time`, `max_age=0`) before sensitive
actions. Web already supports `?reauth` (`maxAge: 0`), and authkit-nextjs has
`checkRecentAuth`. `deleteMyAccount` can't require a recent `auth_time` for web
alone, because web and native tokens share a client. Either ship the native
reauthentication prompt and then enforce it for every client, or move native to
its own WorkOS Application (item 6) and enforce by issuer.

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

Each item runs `bun run verify` and the auth E2E specs
(`packages/tests/src/auth-runtime`, `journey/06-security`,
`journey/07-account-lifecycle`) against the emulator. Items 2 to 5 also check
the behavior in staging before production.
