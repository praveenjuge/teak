## Goal

Find tags that look alike, such as `design` / `designs`, `ux-writing` / `ux writing`, `café` / `cafe` and `javascript` / `javscript`. Teak offers to merge them from the Tags page. Rules find the candidate pairs, Clef confirms the unclear ones, and you review each group: Merge (pick the tag to keep) or Keep separate. Phase 14 of the [roadmap v3](2026-10-19-roadmap-v3-00-roadmap.md).

## Depends on

- Nothing in v3. The Tags page, tag summaries, merge jobs and Clef have all shipped.

## Success Criteria

- **The banner:** opening the Tags page computes duplicate groups across user tags and AI tags. When at least one group exists, a quiet banner appears above the list: "4 groups of tags look alike." with a "Review" button.
- **The review sheet** lists each group:
  - its tags, with card counts;
  - the reason: Plural, Spelling, Accents or Spacing;
  - a choice of the tag to keep, defaulting to the most-used one;
  - a "Merge" button and a "Keep separate" button.
- **Merging a group** runs one existing tag operation that merges every other tag of the group into the kept one. The sheet shows its progress and refreshes the summary.
- **"Keep separate"** is remembered, so the group never comes back unless a new tag joins it.
- **Never suggested:** `secret` and `hidden`, and tags that differ only by case (already one tag, since `tagKey` lowercases).
- **API, MCP, SDK and CLI** can list the duplicate groups. Merging uses the existing merge operation, extended to merge several tags at once.

## Context And Current Facts

- **Tag rules** (`packages/convex/shared/tags.ts`):
  - `tagKey = tag.trim().toLowerCase()` (19).
  - `HIDDEN_TAG_KEYS = ["secret", "hidden"]` (21).
  - `MAX_TAG_NAME_LENGTH = 64`.
  - `rewriteTagList` (68) merges case-insensitively.
  - `TAG_OPERATION_COUNT_LIMIT = 10_000`.
  - `TagOperationKind` is `"rename" | "merge" | "delete"`.
- **Tag summaries** (`packages/convex/tag/tagSummary.ts`): `{ items: { name, count }[], isComplete, computedAt }`, capped at `MAX_TAG_SUMMARY_ITEMS = 3000`.
  - They are computed from `cardSearchTags` (92), which merges user and AI tags (`searchDocumentHelpers.ts:75-79`), and refreshed after a debounce (`TAG_SUMMARY_DEBOUNCE_MS = 15_000`).
- **Tag operations** (`packages/convex/tag/tagOperations.ts`):
  - `startTagOperationForUser` (130) checks `from` and `to`, and refuses merging a tag into itself (`SAME_TAG`).
  - **Only one running operation per user** (`runningOperation`, 122; `TAG_OPERATION_RUNNING` unless the running one has stalled for `TAG_OPERATION_STALL_MS`).
  - Batches rewrite `tags` and `aiTags` (around 290–300).
  - The public mutation `startTagOperation` (389) takes `{ kind, from, to? }`. The queries are `getTagOperation` (401) and `getLatestTagOperation` (413).
- **Public API:**
  - `POST /v1/tags/rename|merge|delete` and `GET /v1/tags/operations/{id}` (`http.ts:94-97,122,189-194`, `publicApiHttpTags.ts`).
  - MCP: `teak_v1_list_tags`, `teak_v1_merge_tags`, `teak_v1_get_tag_operation` (`mcp/tools.ts:838-871`).
- **Tags page** (`packages/ui/src/screens/TagsScreen.tsx`, 416 lines):
  - It reads `api.tags.listTagSummary` and requests a refresh with `requestTagSummary` (207–227).
  - It applies a running operation optimistically with `applyTagOperationToSummary` (238).
  - The row menu has Rename, Merge into… and Delete…, which open `components/modals/TagManagerDialog.tsx`.
  - Progress comes from `hooks/useTagOperations.ts`.
- **AI tags** are lowercased and stripped of hidden tags (`apps/files-worker/src/workflows/cardProcessing/aiMetadata.ts:38` `normalizeAiTags`). The prompt asks for single words with no spaces or hyphens (`packages/files-protocol/src/metadata.ts:5-26`).
- **Clef** `noul` questions return a yes probability (`apps/files-worker/src/decisions.ts` `ClefQuestion`, `readAnswer`), and one request holds up to 64 questions (`MAX_DECISION_QUESTIONS`).
- v2's "Not doing" list had "tidy-up", an automatic one-click tidy. On 2026-10-19 the owner chose this version, which is reviewed instead of automatic.

## Constraints And Non-goals

- **No one-click "merge all"** and no automatic merges. Each group is merged on its own.
- **No undo for a merge.** Existing merges can't be undone either, since Teak doesn't record which card held which tag. The sheet says so beside the Merge button.
- **One running operation per user.** This stays; the sheet disables the other Merge buttons while one runs.
- **Candidate rules** (pure, in `shared/tagSimilarity.ts`) apply only to tags written entirely in Latin script (letters matched by `\p{Script=Latin}`, plus digits and separators). Other tags (CJK, Cyrillic, Arabic and so on) never get a fold key or an edit-distance pair, so they only ever appear as exact case-insensitive matches, which `tagKey` already merges. Each Latin tag reduces to a fold key:
  - NFKD, then accents removed, then lowercased;
  - separators `-`, `_`, `.`, `/` and spaces removed;
  - simple English plurals removed: `ies` becomes `y`, then `es` after `s`/`x`/`ch`/`sh`, then a final `s` for stems of 4+ letters.
- **"Sure" groups** share a fold key. Their reason comes from what differed: Plural, Spacing or Accents.
- **"Unsure" pairs** are tags whose fold keys are within edit distance 1 (both 5–8 characters) or 2 (both 9+), and that don't share a fold key. Clef confirms them, and only pairs scoring at least 0.85 become groups. Clef returns only a `same` probability, so the reason is set by the rules: every confirmed unsure pair is "Spelling" (they are all edit-distance candidates). There is no "Similar meaning" reason in this phase. At most 64 unsure pairs per computation, the most-used first.
- **Groups:**
  - Sure pairs (shared fold key) are grouped with union-find, since a shared key is transitive.
  - An unsure pair confirmed by Clef stays a two-tag group of its own. It is never joined to other groups, so one Merge click never merges a tag that Clef didn't compare with the kept one.
  - A sure group larger than 6 tags is split into consecutive groups of up to 6 in usage order, all sharing the same fold key, and each is reviewed separately; after one is merged, the rest re-form on the next computation.
- **Cost bound:** at most 3,000 summary tags, sorted fold keys plus length buckets for edit distance, and at most one Clef request per computation.
- **Caching:** results are cached per user and recomputed only when the summary's `computedAt` changes, so reopening the page is free.
- **Analytics:** add `tag_cleanup_reviewed { groups }`, `tag_cleanup_merged { size, reason }` and `tag_cleanup_kept_separate { reason }` first.

## Backend

- `shared/tagSimilarity.ts` (new, pure): `foldTag`, `findTagGroups(items, dismissedPairKeys) → { sure: Group[], unsurePairs: Pair[] }`, `pairKey(a, b)` (sorted tag keys) and `groupKey`.
- `schema.ts`:
  - `tagCleanupCache`: `{ userId, summaryComputedAt, groups: v.array(v.object({ tags: v.array(v.string()), reason })), computedAt }`, index `by_userId`.
  - `tagCleanupDismissals`: `{ userId, pairKey, createdAt }`, indexes `by_userId` and `by_userId_and_pairKey`.
  - Both are covered by account deletion (`accountDeletionData.ts` `ancillaryPage`) and seeded in the "complete stages" test. Its batch's `length > 0` joins `ancillaryPage`'s continuation return (`accountDeletionData.ts`, the `return (cardLinks.length > 0 || …)` near line 202), so more than one page of rows is deleted; the test seeds more than 100 rows.
- `tag/tagCleanup.ts` (new):
  - `getTagCleanup` (query): the cached groups, filtered live against the current summary and the dismissals. It returns `{ status: "ready" | "stale" | "none", groups }`.
  - `refreshTagCleanup` (action), called by the Tags page when the status is `stale` or `none` (a capped, incomplete summary is used as described under API, marked `partial`):
    - it reads the summary and dismissals through internal queries;
    - it runs `findTagGroups`, sends the unsure pairs to the Files Worker `decide-tag-pairs` through `ai/decisions.ts` `runDecision`;
    - it writes the cache through an internal mutation.
    - It first claims the computation with an internal mutation that sets `computingUntil = now + 2 min` on the cache row; a call that finds an unexpired claim for the same `summaryComputedAt` returns without calling Clef. The claim expires on its own if the action dies.
    - If the AI gate is denied, or the worker call fails, times out or returns a malformed reply, it stores the sure groups with `aiComplete: false`. A cache with `aiComplete: false` reads as `stale` once 24 hours have passed, so spelling and meaning groups come back after AI is available again.
  - `keepTagsSeparate` (mutation, `{ tags: string[] }`): inserts every pair in the group as a dismissal, up to 15 pairs, and returns their ids.
  - `undoKeepTagsSeparate` (mutation, `{ dismissalIds }`): deletes those dismissals, checking that each belongs to the caller. The toast's Undo calls it.
- `tag/tagOperations.ts`: `startTagOperation` and `startTagOperationForUser` accept an optional `alsoFrom: v.array(v.string())` (at most 5) for `kind: "merge"`.
  - The batch rewrite applies `rewriteTagList` for `from` and then each `alsoFrom` in turn. The existing loop only pages cards indexed under `from` (`by_user_tag_deleted_created`, `tagOperations.ts:258`), so the operation stores a `sourceIndex` cursor and, once the `from` pages are done, pages the cards tagged with each `alsoFrom` in turn. A card already rewritten no longer carries the source tag, so it isn't processed twice. The operation completes only after every source tag's pages are empty.
  - The operation row stores `alsoFrom` for display.
  - The count limit applies to all its source tags together.

## Files Worker

- `packages/files-protocol`: `FILES_OPS` gains `"decide-tag-pairs"`. Add `FilesTagPairsParams { pairs: Array<{ id, a, b }> }` (1–64 pairs, tags up to 64 characters), `FilesTagPairsResult` with `{ scores: Array<{ id, same: number }> }`, and `readTagPairsResult`. `DECISION_VERSIONS.tagPairs = 1`.
- `apps/files-worker/src/decisions.ts`: `buildTagPairsRequest` builds one `noul` question per pair, on `clef-flash`.
  - instructions, built per pair with that pair's own tags: `For organizing saved items, do the tags "${a}" and "${b}" mean the same thing (a typo, spelling variant, plural or synonym)?` (for example `"javascript"` and `"javscript"`). Each tag is JSON-escaped before it is inserted.
  - The state is empty. The reply maps to `same` probabilities.
- Dispatch it in `ops.ts`. The Convex `runDecision` `DecisionOp` union gains it.

## Web

- `TagsScreen.tsx`:
  - It reads `api.tag.tagCleanup.getTagCleanup`. When the status is `stale` or `none` and `summary.isComplete`, it calls `refreshTagCleanup` once per page visit.
  - **Banner:** between the header and the search field, `rounded-lg border bg-muted/40 px-3 py-2 text-sm`, a `Combine` icon, then "2 groups of tags look alike." (singular: "1 group of tags looks alike.") and a ghost "Review" button.
    - It is hidden when there are no groups. It never shows a spinner: while computing, nothing shows.
    - It doesn't shift the list: it mounts with a 150 ms height and opacity ease.
- `components/tags/TagCleanupSheet.tsx` (new): a right-side `Sheet` (width 420) at 768 px and up, and a bottom `Drawer` at 390 px. The title is "Tags that look alike" and the subtitle "Merging moves every card to the tag you keep. It can't be undone."
  - **One card per group:**
    - a reason pill (Plural / Spelling / Accents / Spacing);
    - a `RadioGroup` of the tags, each `#design · 214 cards`, with the default the most used and the label "Keep" on the selected row;
    - the other rows are muted, with "→ design" after the count;
    - buttons "Merge" (secondary) and "Keep separate" (ghost).
  - **While one merge runs:** that card shows "Merging… 120 of 300 cards" from `useTagOperations`, and every other Merge button is disabled with the tooltip "Wait for the current merge to finish".
  - **When it completes**, the card collapses to "Merged into design" for 3 s, then leaves the list.
  - **Keep separate** removes the card at once (optimistic), with the toast "Kept separate · Undo". Undo deletes the dismissals.
  - **When the list empties:** "All tidy." with a Done button.
  - **Keyboard:**
    - Tab moves between groups, and arrow keys move within the radios.
    - Enter on Merge starts it, and Esc closes the sheet.
    - Focus returns to the Review button.
- Row tags use `dir="auto"` and truncate at 1 line. 64-character tags wrap the count onto a second line at 390 px.
- The existing `TagManagerDialog` merge flow doesn't change.

## API / MCP / SDK / CLI

- `GET /v1/tags/duplicates` is a new route: add `"/v1/tags/duplicates"` to the GET paths in `http.ts` (beside `/v1/tags`, line 184) and a branch in `publicApiHttp.ts` (beside line 100). It returns `{ status, groups: [{ tags: [{ name, count }], reason }] }`, read-only, in the same shape as the web.
  - It never calls Clef: it serves the cache, or the sure groups computed on the fly when the cache is missing, so the API doesn't get slower.
  - The tag summary stops at 3,000 tags (`MAX_TAG_SUMMARY_ITEMS`, `isComplete` at `tag/tagSummary.ts:191`). With an incomplete summary, groups are computed from the 3,000 tags it holds and the result says so: `status: "partial"`, and the web banner reads "Likely duplicates among 3,000 of your tags". Nothing claims to cover tags it didn't see.
- `POST /v1/tags/merge` accepts `from` as a string or an array of up to 6 strings (`into` unchanged; that is the merge endpoint's existing field, `publicApiHttpTags.ts:21`). An array is sent as `from[0]` plus `alsoFrom`.
- Add to OpenAPI, and the row in `scripts/public-parity.ts`.
- MCP: `teak_v1_find_duplicate_tags`, and `teak_v1_merge_tags` accepts an array `from`.
- SDK: `tags.duplicates()`, and `tags.merge(from: string | string[], into: string)`, keeping today's positional signature (`client/sdk.ts:1163`) so existing callers still work.
- CLI:
  - `teak tags duplicates` prints the groups as a table;
  - `teak tags merge <from...> --into <to>`.
- "Keep separate" stays web-only: it's a review choice, not data an agent needs. The parity row records that reason.

## Docs

- `features.mdx` → Tags and filters: a "Tidy up tags" paragraph describing the banner, the review, the reasons and that merging can't be undone.
- The API, MCP and CLI docs for `GET /v1/tags/duplicates` and the multi-tag merge.
- The changelog: "Find and merge tags that look alike".

## UI states

- **Empty library or no groups:** no banner.
- **Loading:** no banner until there are results. In the sheet, merges show a progress line.
- **One group vs 40:** the sheet scrolls, with a sticky header and "12 groups" in the subtitle.
- **Long names:** 64-character, emoji, RTL, CJK and Devanagari tags. Folding must not merge CJK tags that only look alike, because the rules apply only to Latin letters (see Risks).
- **Error:**
  - A failed merge shows "Couldn't merge these tags. Try again." on the card.
  - A failed compute shows nothing, because the banner is optional.
- **Rate-limited / busy:** another tag change running elsewhere disables Merge with "Another tag change is still running".

## Scenario seed packs

- `tag-cleanup`:
  - **Rule matches:**
    - plurals: `design`/`designs`, `story`/`stories`, `box`/`boxes`;
    - spacing: `ux-writing`, `ux writing` and `ux_writing`;
    - accents: `café`/`cafe`;
    - typos: `javascript`/`javscript`, `typography`/`typograhpy`.
  - **Clef confirms:** `color`/`colour`.
  - **Must stay apart:** `ui`/`uk`, `bass`/`base`, `art`/`arts` (a real plural that may be intended), `news`/`new`.
  - **Never suggested:** `secret`/`secrets`.
  - **Many groups:** a 3,000-tag library with 40 groups.
  - **Odd names:** CJK tags `设计`/`設計`, an RTL tag, and 64-character tags.
  - **AI tags:** some groups made of AI tags only.

## Break-it checklist

- **UI:**
  - double-click Merge;
  - merge, then close the sheet mid-run and reopen it;
  - two tabs merging different groups;
  - Keep separate then Undo;
  - rename a tag elsewhere while the sheet is open;
  - keyboard only;
  - 390 px drawer.
- **Backend:**
  - Clef timeout, capacity error or bad reply (the sure groups still show);
  - 0 and 64+ unsure pairs;
  - summary not complete (3,001+ tags): a `partial` result and banner;
  - `alsoFrom` with a tag equal to `to`, with duplicates, with 7 entries, or with a hidden tag;
  - merging past the 10,000 limit;
  - a stalled operation;
  - another user's dismissal keys;
  - account deletion with cache and dismissal rows.

## Tests

- `packages/convex/__tests__/shared/tagSimilarity.test.ts`, table-driven:
  - every pack pair above, including the must-not-merge pairs;
  - fold keys for accents and separators;
  - the edit-distance bounds and the group cap;
  - hidden tags excluded.
- `packages/convex/tagCleanup.test.ts` (convex-test, add to `vitest.config.ts`): the cache rules, dismissals filtering, and "a new tag reopens a dismissed group".
- `packages/convex/__tests__/tag/tagOperations.test.ts`: `alsoFrom` merges every source, its limits, and its count across sources.
- `apps/files-worker/src/decisions.test.ts`: `buildTagPairsRequest` and reading the scores.
- `packages/convex/__tests__/publicApiHttpTags.test.ts`: `GET /v1/tags/duplicates` and an array `from`. Plus MCP, SDK and CLI tests.
- `packages/ui/src/components/tags/__tests__/TagCleanupSheet.test.tsx`: the default kept tag, reason labels and disabled states.
- e2e: extend `packages/tests/src/web/tags.e2e.ts` to seed a plural pair, merge it from the sheet, and check the Tags list.

## Proof before the PR

- **Video 1:** open Tags, see the banner, review three groups, change the kept tag in one, merge it, and keep the other separate.
- **Video 2:** merge a large group while trying a second merge (it is disabled), then reload mid-run.
- **Screenshots:** banner, sheet, merging, "All tidy." and the drawer at 390 px. Each in light and dark.
- **Captured:** `GET /v1/tags/duplicates`, a multi-`from` merge, and `teak tags duplicates`.

## Release gate

1. Run the narrow tests, then the repo checks.
2. Seed `tag-cleanup`, run the break-it pass, and fix and add regression tests until it is clean.
3. Send the proof bundle to the owner.
4. Deploy the Files Worker, then Convex and the web app.
5. There is no backfill; the cache fills on first visit.
6. Smoke-test production on the owner's account: the banner appears, and a merge completes.

## Risks And Open Questions

- **English-only plural rules.** Other languages get only the accent, spacing and typo rules, and Clef. Phase 18 makes AI tags multilingual, so cross-language synonyms (`design` and `diseño`) are not found by the rules. Open decision: also send the top cross-script pairs to Clef (default: no, to keep cost bounded).
- **False merges.** `art`/`arts` and `news`/`new` are real hazards. The plural rule needs stems of 4+ letters and excludes a stop list (`news`, `series`, `species`, `glasses`, `arts`). It is reviewed, never automatic.
- **Open decision:** whether to cap the review sheet at 40 groups (default: yes, most-used first).
- **Open decision:** whether "Keep separate" should also hide future pairs between those exact two tags across devices (default: yes; it's stored server-side).
- **Undo for merges** is out of scope. If owners want it, record the affected card IDs per operation (bounded at 10,000) in a later phase.
