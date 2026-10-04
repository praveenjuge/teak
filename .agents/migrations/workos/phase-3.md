# Phase 3 backend integration

## Transactional linking foundation

`workosUsers.linkWorkosUser` is an internal mutation for linking an existing
permanent Teak owner to a WorkOS user. Import, webhook, bootstrap and reconciliation
adapters will share this boundary. It is not called by production runtime yet.

An external ID must select exactly one owner; a missing or conflicting match never
falls back to email. Without an external ID or existing provider link, email matching
requires explicit verification on both the WorkOS claim and the existing owner,
and one matching row. This strengthens the plan against preclaimed legacy accounts. Existing links, deletion
tombstones and active deletion states cannot be overwritten. Index reads and the
link write share one transaction. Conflicts return a quarantine result so its insert
commits. Retries of a successful link are idempotent.

This slice changes only the provider link. It preserves profiles, roles, permanent
owner IDs and cards. It creates no new vault, changes no auth mode and runs no import
or backfill. Quarantine receipts are not event-deduplicated in this foundation.

Real database tests cover malformed inputs, strict matching, competing claims,
retries, deletion states and persisted quarantine. All 222 backend edge tests pass,
including 29 new cases. Six isolated guard mutations fail their regressions. These
controlled tests do not prove hosted deployment concurrency.

## Ordered lifecycle foundation

`workosLifecycle.applyWorkosEvent` is an internal full-envelope mutation. It is not
wired to HTTP or WorkOS callbacks yet. Original event IDs and timestamps enter the
same transaction as linking, provider profile changes and quarantine receipts.
Duplicate deliveries have no effect; older updates cannot overwrite newer state.
Equal-time conflicting profiles clear WorkOS verification and quarantine. Provider
deletion is terminal, including deletion before a mapping exists.

Optional WorkOS email, verification and deletion fields keep provider evidence
separate from the Better Auth mirror. A WorkOS deletion preserves the provider ID,
permanent owner, Better Auth access, roles and cards; it schedules no cleanup.
Provider deletion history also prevents imports or bootstrap from relinking that ID.
Every WorkOS authorization reader must reject duplicate provider mappings and check
that indexed deletion history, including when a row's optional tombstone is absent.
The ledger is authoritative; bounded row patches are supplementary. Corrupted
mapping sets must not trigger an unbounded transaction that could roll back it.
The additive fields and event indexes were explicitly approved; no backfill runs.

The installed AuthKit event callback drops the original ID/time and can suppress or
rewrite callbacks. The verified webhook adapter must pass the original signed
envelope directly to this boundary and synchronize the component without letting
its callback deduplication suppress Teak processing. Database tests do not prove
HTTP signature verification or hosted concurrency; those remain integration gates.

## Before runtime activation

- Wire signature-verified lifecycle ingress and WorkOS-authoritative profile sync.
  Imported unverified users may be linked but cannot access their vault. Connect
  authorization must use WorkOS-specific verification, never the Better Auth mirror.
- Wire the read-only resolver, deliberate bootstrap, REST/MCP audience validation,
  consent/session revocation, account deletion and provider-independent API keys.
- Complete optional dev/prod environment configuration and the dual web integration.
- Import dev users with explicit approval, prove every required client, and rehearse
  cutover and rollback before production activation.

The original migration plan and its production time gates remain in force.
