## Goal

Let people automate their library with simple "when / if / then" rules (for example "when a link from github.com is saved, add tag `code` and put it in Dev"), with a preview and an "apply to existing cards" run. Phase 16 of the [roadmap](2026-10-12-roadmap-00-roadmap.md).

## Depends on

- [Phase 5](2026-10-12-roadmap-05-folders.md) (folder actions and conditions) and [Phase 7](2026-10-12-roadmap-07-search-qualifiers.md) (`urlHost` for "site is").

## Success Criteria

- Up to 50 rules per account, each with a trigger (saved, tag added, tag removed, favorited, archived, added to folder), match all or any, conditions (type is, URL contains, site is, title or content contains, has tag, is favorite) and actions (add or remove tag, add or remove folder, favorite, archive).
- A matching card is changed within seconds of the trigger; a rule's own changes never trigger further rules.
- "Saved" fires exactly once per card, after processing finishes, even when Refresh details runs the pipeline again.
- "Apply to existing" shows a match count first, then runs in batches with progress.
- `/v1/rules` CRUD and apply, MCP tools and CLI commands.

## Context And Current Facts

- `workflows/cardProcessing.ts` ends with an optional `telemetry.events.emitWorkflowCompletion` step and returns a strict `v.union` of a `completed` and a `skipped` object. Appending a step after the telemetry step keeps old journals replayable; any new return field must be optional.
- Refresh details (Phase 1) restarts the same workflow, so the "saved" step needs a once-only guard on the card (`rulesSavedAt`).
- Card writes that can emit events live in `card/updateCard.ts` (`updateCardFieldForUserHandler`), `card/bulkUpdate.ts` (Phase 3), `folders/membership.ts` (Phase 5) and the tag operations workflow (Phase 6).
- Phase 5's `workflows/folderDeletion.ts` is where rules referencing a deleted folder get detached (and the user warned beforehand).
- Settings dialogs live in `packages/ui/src/components/settings/` (for example `ApiKeysDialog.tsx`), which is the pattern for `RulesDialog.tsx`.

## Constraints And Non-goals

- `rules` is a per-user table: add it to `accountDeletionData.ts ancillaryPage`; it holds folder IDs (detached on folder delete) but no card IDs or R2 keys.
- New flags such as `cards.rulesSavedAt` (number) and `rules.enabled` follow the shared rules; boolean flags are `v.optional(v.literal(true))`.
- Card changes made by rules go through the same `performBulkUpdate` / `patchCardWithSearchSync` paths with an `origin: "rule"` marker that suppresses event emission (loop protection).
- The "saved" trigger is a new step appended at the very end of `cardProcessing.ts`.
- "Apply to existing" is its own workflow (`workflows/rulesApplyExisting.ts`), batched, one run per user at a time.
- No webhooks (dropped), no scheduled triggers, no AI conditions.
- Public API order: `publicApiRules.ts` → `publicApiHttpRules.ts` → `executePublicApiOperation` → `http.ts` `/v1/rules` and `/v1/rules/` prefix with OPTIONS → `publicApiOpenApi.ts` → `mcp/tools.ts` → `client/sdk.ts` → CLI.

## Backend

- `schema.ts rules { userId, name, enabled?, trigger, match: "all" | "any", conditions[], actions[], createdAt, updatedAt, lastRunAt? }` with `by_userId_and_trigger`; validators per condition and action kind.
- `rules/evaluate.ts`: pure `ruleMatches(rule, card, event)` and `plannedChanges(rules, card, event)` (dedupes and orders actions; archive last).
- `rules/engine.ts`: `emitCardEvent(ctx, { userId, cardId, kind, detail })` called from update, bulk and membership code when `origin !== "rule"`; loads enabled rules for the trigger and applies changes with `origin: "rule"`.
- `cardProcessing.ts`: final step `rules.engine.runSavedRules({ cardId })` that returns early when `rulesSavedAt` is set, otherwise sets it and emits `saved`.
- `workflows/rulesApplyExisting.ts`: `previewRuleMatches` (bounded count via the Phase 7 planner where possible) then page cards and apply.

## Web

- `packages/ui/src/components/settings/RulesDialog.tsx`: list of rules with an enable switch (Phase 4 `switch`), "New rule" as the one primary action; editor with When / If / Then rows using Select, tag and folder pickers; "Apply to existing…" shows the match count and a confirm.

## API / MCP / SDK / CLI

- `GET/POST /v1/rules`, `GET/PATCH/DELETE /v1/rules/:id`, `POST /v1/rules/:id/apply` (202 with progress), `GET /v1/rules/:id/apply` for status.
- MCP `teak_v1_list_rules`, `teak_v1_create_rule`, `teak_v1_update_rule`, `teak_v1_delete_rule`, `teak_v1_apply_rule`; SDK `rules.*`; CLI `teak rules ls | add | rm | enable | disable | apply`.

## Docs

- `features.mdx`: new "Rules" subsection with two examples.
- `(developers)/api.mdx`, `mcp.mdx`, `(apps)/cli.mdx`.
- Ship-month changelog: "Automate your library with rules".

## UI states

- Empty: "No rules yet. Rules tag, file or archive cards for you." with "New rule".
- Loading: rule rows as skeletons; apply progress in a toast.
- One item / many items: 50 rules list with the cap message on the 51st.
- Very long names: rule names and long tag or folder names truncate; the editor wraps rows.
- Error: invalid rule (no actions) blocks save with an inline message; a rule pointing at a deleted folder shows "Folder deleted" and is disabled.
- Rate-limited: a second apply while one runs shows "Already applying a rule."
- UI bar: editor rows reuse Select and the Phase 5 folder picker; one primary action per view.

## Scenario seed packs

- `rules`: 50 rules covering every trigger, condition and action; rules that would loop (A adds tag x, B on tag x archives, C on archive removes tag x); 1,000 cards for apply-to-existing; rules referencing a folder that then gets deleted.

## Break-it checklist

- UI: toggle a rule rapidly; save the same rule twice fast; apply to existing then reload; edit a rule during its apply run; 390px editor; keyboard-only rule creation.
- Backend: evaluator table over all conditions and match modes; loop rules produce no cascade; saved fires once across Refresh details; bulk 100 cards emits 100 events without OCC storms; 51st rule rejected; another user's rule ID; folder deletion detaches; account deletion removes rules.

## Tests

- `packages/convex/__tests__/rules/evaluate.test.ts`: condition and action tables; all/any; action ordering and dedupe.
- `packages/convex/rules.test.ts` (convex-test, add to `vitest.config.ts`): no cascades from rule-originated changes; saved fires once with `rulesSavedAt`; bulk emits per card.
- `packages/convex/__tests__/workflows/rulesApplyExisting.test.ts`: preview count, batching, one run per user.
- `packages/convex/__tests__/workflows/cardProcessing.test.ts`: new final step runs after telemetry and tolerates a missing card.
- `packages/convex/__tests__/publicApiHttpRules.test.ts` and `mcp.test.ts`.

## Proof before the PR

- Video: create "github.com links → tag code, folder Dev", save a GitHub link and watch it update; create a loop pair and show no cascade; apply a rule to existing cards with progress.
- Screenshots: rules list empty and populated, editor, apply confirm, errors; light and dark; 390px and 1440px.
- Captured `/v1/rules` CRUD and apply, MCP output, `teak rules ls`.

## Release gate

1. Narrow tests above, then the repo checks and `03-api.e2e.ts`, `04-cli.e2e.ts`, `05-mcp.e2e.ts`, `13-occ-concurrency.e2e.ts`.
2. Seed `rules`, run the break-it pass, fix and add regression tests.
3. Proof bundle as above.
4. PR, green CI, merge, deploy Convex then web. No backfill: existing cards have no `rulesSavedAt` and are only touched by "apply to existing". In-flight card workflows replay safely because the new step is last. Smoke-test production with one rule on a test link.

## Risks And Open Questions

- Rules firing on imported cards: imports go through the processing workflow, so "saved" rules apply to every imported card; proposed to keep that and say so in the docs.
- Event volume from bulk operations: emit once per card per bulk call, not per field.
