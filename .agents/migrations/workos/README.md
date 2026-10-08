# WorkOS migration record

Production moved from Better Auth to WorkOS AuthKit on 7 October 2026, and
sign-ups reopened the same day. The cutover, import and rollback tooling was
removed after the cutover: rollback cannot succeed once WorkOS-only accounts
exist. The full phase plans and evidence are in git history before this file.

## Retained data and backups

- The Better Auth Convex component stays mounted and
  `packages/convex/migration/exportBetterAuth.ts` stays, so legacy data remains
  readable. Deleting Better Auth or customer data needs explicit owner approval.
- Encrypted local evidence: `/Users/praveenjuge/Documents/TeakMigrationBackups/2026-10-03-phase-r`.
- Encrypted remote copy: private R2 bucket `teak-workos-migration-backup-20261003`
  (APAC Standard). The approved migration plan is in it as `approved-plan.txt.gpg`.
- Never remove either copy before the approved retention period.

## Recovering an uncertain Connect disconnect

An `unknown` or stale `dispatched` operation stays denied. An HTTP rejection,
missing provider listing, or elapsed time cannot prove that the original DELETE
finished. Never retry that DELETE or clear its fence to permit reconnect.

Recovery is internal-only and needs a separately approved exact operation:

1. Preserve the fence, trigger-consent row and provider request evidence in the
   encrypted Mac/R2 backup. Read the target's runtime pins without logging its key.
2. Run `workosDisconnectRecovery:inspect` against the explicit deployment with
   `fenceId`, `cloudUrl`, `siteUrl`, `environmentId`, `authKitClientId`,
   `authKitDomain` and `credentialFingerprint` (SHA-256 of the API key).
   Stop if inspection returns null or any target differs.
3. Obtain positive evidence for the original request: a preserved successful
   204, or written provider confirmation that deletion completed and no original
   request remains pending. Record its private reference and original request ID.
   The operator must review this evidence; the recovery API validates an
   attestation, not the provider's evidence itself.
4. Prepare a private JSON proposal from the inspection output, omitting `state`.
   Retain every operation field and `snapshotDigest` unchanged. Add the separate
   `approvalReference` and `evidence` containing `kind` (`preserved-204` or
   `provider-written-confirmation`), `reference`, `originalRequestId`,
   `originalDeletionCompleted: true` and `noPendingOriginalRequest: true`.
   Obtain human approval for this proposal before executing it.
5. Run `workosDisconnectRecovery:recover` with that exact proposal and explicit
   deployment selector. It sends no provider requests. It records the receipt on
   the fence and permanent consent tombstone, denies all recorded sibling grants,
   and retains the 305-second reconnect fence. A 503 is not completion; resume
   only the identical approved operation. Changed pins, generation, evidence or
   snapshot require a new inspection and decision.
6. Verify the matching operation is completed, its permanent receipt is retained,
   old grants remain denied and reconnect succeeds only after the fence expires.
   Preserve the result in the encrypted evidence checkpoint.

Deployment of these functions does not approve or execute recovery. No recovery
activation has been performed as part of this preparation.
