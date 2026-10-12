## Goal

Close out the roadmap: drop the indexes the new list, archive and tag paths replaced, audit that the API, MCP, SDK and CLI expose every feature consistently, and add one journey e2e that walks folders, tags, rules and shares end to end. Phase 19 of the [roadmap](2026-10-12-roadmap-00-roadmap.md).

## Depends on

- All earlier phases ([1](2026-10-12-roadmap-01-card-detail-quick-wins.md) to [18](2026-10-12-roadmap-18-public-share-links.md)) merged, deployed and stable in production.

## Success Criteria

- No code reads a superseded index, and those indexes are removed from `schema.ts` without a deploy error or a slower query.
- A parity table shows every feature on web, API, MCP, SDK and CLI with identical names, defaults and error codes; every gap is fixed or documented as intentional.
- `packages/tests/src/journey/14-organize.e2e.ts` passes locally and in the E2E workflow.
- `apps/docs` API, MCP and CLI pages match the OpenAPI document and the tool list.

## Context And Current Facts

- Superseded index candidates and their current readers (non-test files):
  - `cards.by_user_type_deleted` and `by_user_favorites_deleted`: `publicApi.ts`, `card/getCards.ts`, `raycast.ts`.
  - `cards.by_created` (`["userId", "createdAt"]`): `dataExport.ts`, `publicApi.ts`, `card/getCards.ts`, `raycast.ts`.
  - `cards.by_user_deleted`: widely used as a user prefix (`admin.ts`, `accountDeletion.ts`, `accountDeletionBatch.ts`, `card/quota.ts`, `card/cardUsage.ts`, `card/defaultCards.ts`, `card/getCard.ts`, `card/getCards.ts`, `devSeed.ts`, `publicApi.ts`, `raycast.ts`). Dropping it requires moving each reader to a `by_user_deleted_archived_*` prefix first; keeping it may be cheaper.
  - `cardSearchTags.by_user_tag_deleted_created`, `_type`, `_favorited`, `_type_favorited`: `publicApi.ts`, `card/searchDocumentHelpers.ts`; replaced by Phase 3's `_v2` indexes.
- Existing journeys in `packages/tests/src/journey/` are numbered 01 to 13 with gaps at 10 and 12; `14-organize.e2e.ts` is the next free number. Helpers live in `packages/tests/src/helpers/` (`app.ts`, `api.ts`, `cli.ts`, `mcp.ts`).
- Public surface sources to compare: routes in `http.ts`, `executePublicApiOperation` (`publicApiHttp.ts`), `publicApiOpenApi.ts`, tool definitions in `mcp/tools.ts`, `client/sdk.ts`, and `apps/cli/src/index.ts`.
- Docs to reconcile: `apps/docs/content/docs/(developers)/api.mdx`, `mcp.mdx`, `content/docs/(apps)/cli.mdx`.

## Constraints And Non-goals

- Drop an index only after a deploy where no code reads it, confirmed by grep and by a production deploy that ran for at least one full day.
- Drop indexes in a separate commit from code changes so a revert restores them cleanly.
- No new features. Parity fixes add missing parameters or commands only where the feature already exists on another surface.
- No backfill.

## Backend

- Move remaining readers (including `raycast.ts` and `dataExport.ts`) to `buildCardListQuery` or the `_archived_` indexes; move tag readers to `_v2`.
- Remove superseded indexes from `schema.ts`; keep `by_user_deleted` unless every reader has moved.
- Add a scripted parity check (`scripts/check-public-parity.ts` or a Bun test) that compares OpenAPI operation IDs, MCP tool names and SDK methods against a checked-in table.
- Recompute folder `activeCardCount` if drift was observed after Phase 5.

## Web

- None beyond fixes found by the journey test.

## API / MCP / SDK / CLI

- Fill parity gaps from the table (for example a filter present on `GET /v1/cards` but missing from an MCP tool or a CLI flag).
- Error code consistency: `INVALID_INPUT`, `INVALID_CURSOR`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED` with `retryAt` across all new endpoints.

## Docs

- Reconcile `api.mdx`, `mcp.mdx` and `cli.mdx` with the parity table. No changelog entry unless a user-visible fix ships.

## UI states

- No new UI. The journey test checks the existing empty, populated and error states of folders, tags, rules and shares on the way.
- UI bar: run a final pass over every new surface at 390px, 768px and 1440px, light and dark, and file any drift as fixes in this PR.

## Scenario seed packs

- Run every pack added by Phases 1 to 18 on one fresh dev account to confirm they still apply cleanly together.

## Break-it checklist

- UI: run the combined break-it list once more on the full feature set (bulk 300, URL state, two tabs, offline, keyboard-only, 390px drawer, dark mode).
- Backend: re-run caps and limits (100-item bulk, 50 folders per card, 500 folders, 50 rules, 100 feeds, 200-card cap); ownership checks on every new endpoint with another user's IDs; bad cursors and missing auth on every list endpoint; account deletion on an account using every feature leaves zero rows in every new table and zero R2 objects.

## Tests

- `packages/tests/src/journey/14-organize.e2e.ts`: create folders, add cards in bulk, rename a tag, create a rule that files a saved link, save a link and see it filed, share the folder and view it signed out, revoke.
- Parity check test: fails when a public operation lacks an MCP tool, SDK method or CLI command (or an allow-listed exception).
- `packages/convex/accountDeletionWorkflow.test.ts`: extend to seed every new table and assert all are empty after deletion.
- Existing list, search and tag tests stay green after the index moves.

## Proof before the PR

- Video: the journey run (headed) from folders to shares.
- Screenshots: parity table output; a sample of each new surface at 390px and 1440px, light and dark.
- Captured index list before and after (`npx convex` schema diff) and the parity script output.

## Release gate

1. Narrow tests above, then the repo checks and the full `packages/tests` suite including `14-organize.e2e.ts`.
2. Run all seed packs, the combined break-it pass, fix and add regression tests.
3. Proof bundle as above.
4. PR, green CI, merge. Deploy the code moves first; after a day with no reads of the old indexes, deploy the index removal. Smoke-test production list, search and tag views after each deploy.

## Risks And Open Questions

- Dropping `by_user_deleted` touches account deletion and quota code; if the payoff is small, keep it and drop only the type, favorites and tag indexes.
