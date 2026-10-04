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

## Remaining work

- Mobile AuthKit PKCE, secure refresh rotation, bootstrap/offline recovery, and
  Convex provider; preserve Better Auth until the flag switches. Electron is skipped.
- Wire CLI, Raycast, Chrome/Firefox, and Safari to discovery and Teak-owned identity.
- Configure and prove each WorkOS client registration in dev and prod.
- Verify both modes and real public/client journeys before releases.
- Follow lockstep version and store runbooks; record each live release date.
  The three-week cutover gate starts after the final required store release.
