# Sunset list

Compatibility code Teak keeps on purpose, and what has to be true before each
piece can go. Add an entry when you keep code only for old clients or old
data, and delete the entry in the PR that removes the code.

| Code | Kept for | Remove when |
| --- | --- | --- |
| `accountChangesPaused` in `auth:getAuthMode` (`packages/convex/auth.ts`), always `false` | Released Apple and Android builds decode it as a required field. The pause switch itself is gone. | Every supported Apple and Android build is one that no longer reads it. |
| Better Auth component mount (`convex.config.ts`), `legacyBetterAuth.ts`, `migration/exportBetterAuth.ts`, and the `@convex-dev/better-auth` and `better-auth` packages | Retained pre-WorkOS data: account deletion cleans a legacy owner's rows, and the backup exporter reads them. | The retention period in `migrations/workos/README.md` ends and the owner approves deleting the data. Unmounting the component deletes it. |
| `accountDeletionStates.initiationProvider: "betterauth"` (`schema.ts`) | Deletion rows started before WorkOS. Only `"workos"` is written now. | A backfill clears or rewrites those rows. |
| `workosApplicationDisconnects.recoveryReceipt` and the `disconnectRecoveryReceipt` validator (`schema.ts`) | Disconnect rows from the previous Connect flow, which still deny their app (`migrations/workos/README.md`). Nothing inserts new rows. | Those rows have completed or been cleared. |
| `cards.placeholderHash`, `derivativeVersion`, `derivativeCheckedAt` (`schema.ts`) | Stored rows may still hold them. No code reads or writes them. | A backfill unsets them on every card; then drop them from the schema. |
| `LEGACY_ONBOARDING_CARD_CONTENTS` (`card/defaultCards.ts`) | Admin stats recognise onboarding cards created before they were marked. | Those cards are backfilled with the current marker. |
| Raycast `apiKey` preference (`apps/raycast/src/lib/preferences.ts`) | People who pasted an API key before browser sign-in existed. | Raycast drops API-key sign-in. |
| CLI credentials without a `binding` (`apps/cli/src/runtime.ts`, `legacy-logout.test.ts`) | Credential files saved before the CLI recorded which server issued them. | Those tokens have expired everywhere (refresh tokens included). |
