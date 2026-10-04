# Phase 2 client migration

## Shared discovery foundation

`discoverAuthServer(siteUrl)` is exported from `@teak/convex/sdk`. It reads the
protected-resource document, Teak client IDs, and RFC 8414 server metadata. It
requires matching issuers, the exact MCP resource, and S256 PKCE; validates URLs
and bounds each document to 64 KiB. Requests carry no credentials and reject
redirects. Results are immutable and cached for at most 60 seconds per deployment
and transport. Stale configuration, sign-in, and refresh failures call it with `forceRefresh: true`.

A cloud development deployment can explicitly permit its local sign-in origin
with `localIssuer`. Untrusted remote metadata cannot permit loopback access, and
permissive development results cannot enter the default cache.

The additive client-ID route currently advertises seeded Better Auth clients.
Phase 3 must switch it atomically with auth mode and protected-resource metadata
before advertising WorkOS. The legacy seeder stays intact for existing builds.
Authorization-server metadata now advertises the existing Convex revocation route,
which is separate from the app origin. The public docs gateway forwards client
metadata to Convex.

Live cloud dev discovery returned the local issuer, cloud dev resource, legacy
CLI client ID, and the existing revocation endpoint. Transport-boundary
tests cover both provider documents, mismatches, cache expiry/refresh/races,
timeouts, unsafe URLs, malformed/oversized responses, and loopback development.
Removing issuer validation causes its regression to fail. Gateway tests and the
207-test web suite pass. This is a foundation, not a completed client release.

## Mobile session and provider preparation

The canonical mobile source now contains the AuthKit session manager and Expo
system-browser PKCE flow. Only the public client ID is sent; provider tokens are
not retained. Secure storage uses a per-environment client key, saves rotated
credentials before publishing, and serializes writes with sign-out. Expired tokens
are never returned during an outage; reconnect can retry the retained refresh token.
Browser cancellation preserves a concurrent refresh, while sign-out cancels pending
callbacks and late refreshes. Callback state and S256 PKCE are checked before exchange.
The Expo browser supports AuthKit, Google and Apple with `teak://auth/callback`.

The app now selects its provider from a public, reactive configuration query and
keeps a deployment-scoped cache for offline startup. Delayed cache reads cannot
override live configuration. Switching away from WorkOS clears its local session.
The backend query still always selects Better Auth; its optional AuthKit client ID
is public configuration, and no API key is returned. Email, Google and Apple screens
use the prepared hosted flow only in WorkOS mode. Registration respects the freeze.

All 226 mobile tests and typecheck pass. Removing sign-out invalidation fails its
late-refresh regression. A mounted React browser fixture exercises the actual
bootstrap and provider modules with controlled network/native boundaries: refresh
completion and failure release loading, stale cache cannot replace live mode,
configuration failure hides the splash and exposes retry, and expired credentials
survive an outage and refresh on reconnect. Inverting the completion guard leaves
the fixture loading, proving that regression is observable. Provider rollback clears
the stored WorkOS session before selecting Better Auth. Evidence and the repeatable
fixture are retained with the migration backup checkpoint.

Canonical redirect registration, server revocation and WorkOS account deletion
remain Phase 3 dependencies before activation or release. The logout browser opener
alone does not establish server revocation. The fixture does not prove native UI or
real WorkOS service behavior. No WorkOS production activation or store release has
occurred.

## Remaining work

- Mobile AuthKit PKCE, secure refresh rotation, bootstrap/offline recovery, and
  Convex provider; preserve Better Auth until the flag switches. Electron is skipped.
- Wire CLI, Raycast, Chrome/Firefox, and Safari to discovery and Teak-owned identity.
- Configure and prove each WorkOS client registration in dev and prod.
- Verify both modes and real public/client journeys before releases.
- Follow lockstep version and store runbooks; record each live release date.
  The three-week cutover gate starts after the final required store release.
