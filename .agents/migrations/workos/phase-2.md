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

## Standalone SDK distribution preparation

`packages/sdk` builds `teak-sdk` directly from the canonical Convex client SDK.
It bundles browser-compatible JavaScript and emits the declaration dependency
tree, with no runtime workspace dependencies. Distribution-only declaration
transforms add ESM import extensions for NodeNext. Turbo tracks the canonical
client, shared helpers and development URL source as build inputs.

A packed tarball installs through `npm ci` in a fresh consumer outside the repo.
Its types compile under both Bundler and NodeNext resolution; the installed
package discovers both providers through a controlled server under Node.
Removing the type export fails the consumer check. The NodeNext check reproduced
extensionless declaration failures before the output transform was added.

This prepares a registry dependency for Raycast's standalone store source tree
without duplicating discovery logic. npm publisher configuration, lockstep release
preparation, publication and Raycast consumption remain outstanding. No package
has been published and no authentication mode has changed.

## Mobile session and provider preparation

The canonical mobile source now contains the AuthKit session manager and Expo
system-browser PKCE flow. Only the public client ID is sent; provider tokens are
not retained. Secure storage uses a per-environment client key, saves rotated
credentials before publishing, and serializes writes with sign-out. Expired tokens
are never returned during an outage; reconnect can retry the retained refresh token.
A login commits when its validated serialized storage write starts; a later browser
cancellation cannot leave a rejected login hidden in storage. Queued, invalidated
logins never publish an unsaved session. Browser cancellation preserves a concurrent
refresh, while sign-out cancels pending
callbacks and late refreshes. Callback state and S256 PKCE are checked before exchange.
The Expo browser supports AuthKit, Google and Apple with `teak://auth/callback`.

The app now selects its provider from a public, reactive configuration query and
keeps a deployment-scoped cache for offline startup. Delayed cache reads cannot
override live configuration. Switching away from WorkOS clears its local session.
The backend query still always selects Better Auth; its optional AuthKit client ID
is public configuration, and no API key is returned. Email, Google and Apple screens
use the prepared hosted flow only in WorkOS mode. Registration respects the freeze.

All 230 mobile tests and typecheck pass. Removing sign-out invalidation fails its
late-refresh regression. A mounted React browser fixture exercises the actual
bootstrap and provider modules with controlled network/native boundaries: refresh
completion and failure release loading, stale cache cannot replace live mode,
configuration failure hides the splash and exposes retry, and expired credentials
survive an outage and refresh on reconnect. A service outage while connectivity
stays online retries retained credentials with a one-second initial delay, doubling
up to one minute; the mounted fixture recovers without a connectivity toggle or
another sign-in. Failed Keychain reads preserve the credential and signal an
unresolved stored session; foregrounding after unlocking restores the original
session without restarting the app. Inverting the completion guard leaves
the fixture loading, proving that regression is observable. Provider rollback clears
the stored WorkOS session before selecting Better Auth. Evidence and the repeatable
fixture are retained with the migration backup checkpoint.

Canonical redirect registration, server revocation and WorkOS account deletion
remain Phase 3 dependencies before activation or release. The logout browser opener
alone does not establish server revocation. The fixture does not prove native UI or
real WorkOS service behavior. No WorkOS production activation or store release has
occurred.

## CLI discovery preparation

The CLI now discovers authorization, token and revocation endpoints and its client
ID. WorkOS authorization, code exchange and refresh include the API resource.
Credential storage is scoped to the API deployment and bound to issuer and client
ID; existing production Better Auth credentials remain usable. Development cannot
read or clear the production installation's credentials.

Refresh rotation persists before publishing. A private per-account process lock
coordinates refresh, logout and credential replacement across CLI processes.
Provider changes retain old credentials for explicit revocation while blocking API
use. Stale 401 responses reuse a newer credential; the SDK passes the rejected
request's token to its provider. Service outages retain credentials for retry.
Sign-in rechecks metadata before code exchange, validates state as bytes and falls
back when the first loopback port is occupied. Logout revokes at the saved provider
endpoint after a provider switch, retains credentials on failure and cancels pending
browser sign-ins. Reconnect revokes the previous grant before replacing it.
Uncommitted grants are revoked if storage locking fails. Dead-owner recovery uses
generation-bound sibling claims; stale contenders cannot wedge replacement locks.
Unbound production credentials retain their original Teak revocation route after
a provider switch, including failure retention and retry. Owner metadata publishes
atomically; restrictive umasks do not weaken the permission regression. Missing or
corrupt metadata and abandoned reclamation claims require manual inspection;
uncertain locks are never reclaimed by age.

All 69 CLI tests pass, including 45 randomized lifecycle/lock tests, with typecheck
and executable build.
Subprocess journeys use the real CLI, callback server, discovery and SDK with a
controlled OAuth/API server and isolated credential-store boundary. Bypassing the process lock fails the two-process refresh regression; the same-client
stale-401 and localhost regressions also failed before their corrections. Unsafe discovered endpoints are rejected
before refresh or revocation transmits credentials; an endpoint move during
browser sign-in uses refreshed metadata. The endpoint regression failed before
the correction. This proves the controlled journeys;
live Better Auth and WorkOS journeys, server consent revocation, registration and
publication remain outstanding. No CLI release or provider activation has occurred.

## Chrome and Firefox preparation

The extension reads validated discovery for authorization, token exchange,
revocation, and surface-specific client IDs. Production discovery uses the public
Teak origin whose advertised resource is `https://teakvault.com/mcp`; API calls
retain the configured Convex site. Development discovery uses its selected Convex
site. WorkOS requests include the API
resource in authorization and both token grants. Stored credentials bind to the
selected deployment, issuer, and client; development uses separate keys and cannot
read or clear production credentials. Only the original production Better Auth
registration accepts an unbound legacy credential. Pending capture ownership keeps
its permanent Teak ID when provider changes require reconnect.

`GET /v1/me` returns `{data:{id,email,name?}}` through existing public API bearer
validation, rate limiting, and CORS. `id` is the permanent owner ID; the mirror owns
email when present. Revoked, expired, deleted, and unmapped credentials fail closed.
The optional name still reads the legacy profile. WorkOS JWT validation and the
final removal of that lookup remain later-phase dependencies.

The background flow validates PKCE state and the native callback before exchange,
refetches discovery on failures, rejects provider changes, and serializes refresh
and sign-out. Rotated credentials persist before further network operations.
Metadata outages retain the replacement refresh token and block API requests.
Configured API origins and every credential request use the same shared URL
validation policy. Unsafe origins fail before sign-in; loopback is permitted only
in development. Foreign API URLs cannot receive credentials. Chrome retains protected worker
storage; Firefox retains extension-origin IndexedDB.

Run the isolated browser proof with:

```sh
bun --no-env-file x playwright-core install chromium firefox
bun --no-env-file run --cwd packages/tests e2e:extension:runtime
```

It compiles the canonical module and exercises both providers in Chromium and
Firefox, including native Firefox IndexedDB, module reload, concurrent refresh,
canonical identity, and logout. Its dedicated CI workflow keeps counts-only proof
attachments and failure traces. OAuth endpoints and browser identity APIs are
controlled boundaries; this proves runtime/storage behavior, not real provider
consent, extension-origin isolation, or production authentication. Chrome Web Store
and AMO client registrations and real sign-ins must still be verified before release.

## Teak for Mac preparation

Teak for Mac and its bundled Safari extension use one shared discovery and
credential implementation. Production discovers from `https://teakvault.com`
while API transport stays on the configured Convex site. Development discovers
from its development site and explicitly permits the local sign-in origin.
Debug uses separate Keychain and lock names, preserving production credentials.
Both builds validate bounded metadata, matching issuer/resource/client IDs,
S256 PKCE, public HTTPS endpoints, and reject redirects and cookies.

Authorization, code exchange, and refresh use the discovered Mac client and
include the API resource in WorkOS mode. Sign-in validates the permanent owner
through `/v1/me` before persistence. Provider changes block API access while
retaining the original revocation binding. Rotated refresh tokens persist before
further discovery; outages preserve credentials for retry. App and extension
serialize credential changes with the existing process-shared filesystem lock.
Failed revocation preserves the connection. Logout invalidates pending callbacks.

Cancellation before replacement commits rejects and revokes the uncommitted grant.
Once replacement starts revoking an existing grant, it finishes under the shared
lock; explicit sign-out waits for it and revokes the replacement. If storage fails
after old-grant revocation, the revoked credential is cleared and the new grant
receives cleanup. The UI cannot report that old connection as usable.

The Swift runtime suite exercises canonical service code with controlled HTTP
and credential storage, including both providers, restart, identity, refresh,
provider changes, cancellation, safe logout, and concurrent app/extension service
instances. `Mac OAuth Runtime` runs Debug and Release and retains logs. Local
unsigned Debug and Release builds prove both Xcode targets compile. These are
controlled runtime/build proofs; real provider consent and the signed Mac app
with its bundled Safari extension still require verification before distribution.
This is one Mac app integration and release, not a separate Safari release.

## Remaining work

- Activate and prove the prepared mobile integration after Phase 3 server
  revocation, deletion, and canonical redirect setup. Preserve Better Auth until
  the flag switches. Electron is skipped.
- Finish CLI service proof, Raycast, and real Mac app verification; validate the
  prepared Chrome/Firefox flow with real provider registrations.
- Configure and prove each WorkOS client registration in dev and prod.
- Verify both modes and real public/client journeys before releases.
- Follow lockstep version and store runbooks; record each live release date.
  The three-week cutover gate starts after the final required store release.
