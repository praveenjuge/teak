## Goal

When a new card belongs in one of your folders, Teak suggests that folder, and one click files it. Clef picks the folder during card processing. The suggestion shows as a quiet chip in the browser extension's popup and in the card's side panel. Nothing is ever filed automatically. Phase 13 of the [roadmap v3](2026-10-19-roadmap-v3-00-roadmap.md).

## Depends on

- Nothing in v3. Clef decisions, folders and the card-processing workflow have all shipped.

## Success Criteria

- **Which cards and folders:**
  - A new card that is in no folder gets at most one suggestion.
  - The candidates are the user's manual folders with 5 or more active cards.
  - Clef answers with one of those folders or "None". The suggestion is stored only when Clef is at least as confident as the threshold.
- **Side panel:** a card with a suggestion and no folders shows `Add to <folder>` under the Folders row.
  - One click adds the card to the folder through the existing membership mutation, with an undo toast.
  - A dismiss button hides the chip for that card for good, so Refresh details doesn't bring it back.
- **Extension popup:** after a save, while the popup is open, the same chip appears under the note once processing has picked a folder. Accept and dismiss work as in the side panel.
- **When the suggestion goes away:**
  - Adding the card to any folder, by any route, clears it.
  - If the suggested folder is deleted, turned into a smart folder or drops below 5 cards, the chip never shows.
- **Other surfaces:**
  - The API, MCP, SDK and CLI expose the suggestion on a card, read-only, and can dismiss it.
  - Accepting it is the existing "add cards to folder" operation.
- No new UI in the native apps. They ignore the new card fields.

## Context And Current Facts

- **Clef protocol** (`packages/files-protocol/src/decisions.ts`):
  - Models: `CLEF_MODEL_ID` and `CLEF_FLASH_MODEL_ID`.
  - Constants: `MAX_DECISION_QUESTIONS = 64`, `DECISION_VERSIONS` (`cardType`, `linkCategory`, `relevance`, `visualStyles`) and `DECISION_THRESHOLDS`.
  - Each decision has a reader function, for example `readLinkCategoryDecision`.
  - Ops are listed in `FILES_OPS` (`packages/files-protocol/src/index.ts:70-73`) and dispatched in `apps/files-worker/src/ops.ts:687-705`.
- **Worker side** (`apps/files-worker/src/decisions.ts`):
  - `runClef` (around line 245) checks the question count, calls `ai.run`, retries capacity errors twice, and parses the reply with `parseClefReply`.
  - A `choice` question takes `criteria: Record<string, description>`. The reply's `choice` must be one of those keys and carries a probability for every key (`readAnswer`, around line 140).
  - `buildLinkCategoryRequest` and `decideLinkCategory` (around lines 315–400) are the template: build the state, ask one choice question, and return `decision: null` below the threshold.
- **Calling Clef from a workflow step:** `apps/files-worker/src/workflows/cardProcessing/decisions.ts` `runDecision` checks the AI gate (`internal.adminAccess.getAiGate`), applies a 3 s timeout, records telemetry and meters usage. `DecisionOp` and `DECISION_MODELS` list the ops it accepts.
  - The Convex-side `packages/convex/ai/decisions.ts` `runDecision` does the same from Convex actions.
- **Card processing** (`apps/files-worker/src/workflows/cardProcessing/run.ts`):
  - The steps end with "read link image text" (382), "emit completion" (393) and "transcribe podcast" (447).
  - "generate metadata" (`runMetadataStep`, 466–503) produces `aiTags` and `aiSummary`.
  - New steps go after the existing ones. Each passes `guard` and calls only functions listed in `packages/convex/workflowRpcAllowlist.ts`.
- **Folders:**
  - The table is at `schema.ts:774-787`: `kind` manual or smart, `activeCardCount`, `deletingAt`, and the indexes `by_userId_and_nameKey` and `by_userId_and_createdAt`.
  - `folderCards` (788) has the index `by_folderId_and_isDeleted_and_isArchived_and_cardCreatedAt`, which gives a folder's newest active cards.
  - Limits (`shared/folders.ts`): 500 folders per user and 50 per card.
- **Membership writes:** `folder/membership.ts` has `setCardFoldersForUser` (79), `addCardsToFolder` (230) and `setCardFolders` (267).
- **Folders in the public API:**
  - `POST /v1/folders/{id}/cards` is `addCardsToFolder` (`publicApiOpenApi.ts:2043`).
  - `PATCH /v1/cards/{id}` accepts `folderIds` (`publicApiHttpValidation.ts:911`).
  - `serializeCard` returns `folderIds` (`publicApiHttpValidation.ts:143`).
- **Side panel:** `packages/ui/src/components/card-modal/CardMetadataPanel.tsx` builds the Folders row at 425–454. It shows "Add…" when the card is in no folder and opens `CardFoldersDialog`. It resolves folders with `useFolders()` (195).
- **Extension popup** (`apps/extension/entrypoints/popup/SaveDetails.tsx`):
  - It shows tags and a note after a save, and loads them through `LOAD_SAVE_DETAILS`.
  - `apps/extension/lib/cardDetails.ts` `loadSaveDetails` (77) calls `/v1/tags`, plus `/v1/cards/:id` when the page was already saved.
  - `patchCard` (43) sends `PATCH /v1/cards/:id`.
  - There is no folder UI in the popup today.
- **Timing:** the popup appears within about 300 ms of a save, but "generate metadata" finishes seconds later. So a brand-new card has no suggestion when the popup first renders.

## Constraints And Non-goals

- **Never filed automatically.** No setting, and no bulk "file all".
- **Eligible folders:** manual folders with `activeCardCount >= 5`, not `deletingAt`. Smart folders are never suggested.
- **Hidden cards** (user tag `secret`/`hidden`) are skipped. So are cards in Trash, and cards that are already in a folder when the step runs.
- **Candidate cap:** at most 40 folders per request, the ones with the most active cards, ties broken by the newest `updatedAt`. A choice question with hundreds of options is slow and less accurate (see Risks).
- **Samples:** for each candidate, its name and the titles of its 5 newest active cards, each clipped to 120 characters.
- **The card's state:** title, AI summary, user and AI tags, host and type.
- **Threshold:** `DECISION_THRESHOLDS.folder = 0.8`, `DECISION_VERSIONS.folder = 1`. "None" or a lower score stores nothing.
- **No search-document change.** The suggestion isn't searchable.
- **Analytics:** add `folder_suggestion_accepted { surface }` and `folder_suggestion_dismissed { surface }` to `shared/analytics.ts` first. `surface` is `web` or `extension`.

## Backend

- `schema.ts` `cards`:
  - `folderSuggestion: v.optional(v.object({ folderId: v.id("folders"), confidence: v.number(), version: v.number(), decidedAt: v.number() }))`
  - `folderSuggestionDismissed: v.optional(v.literal(true))`
- `folder/suggestions.ts` (new):
  - `listFolderSuggestionCandidates` (internal query, `{ userId, cardId }`). It returns `null` when the card is missing, trashed, hidden, already in a folder or dismissed. Otherwise it returns the card state and up to 40 candidates, each `{ key: "f0".."f39", folderId, name, samples }`.
    - The samples come from the `folderCards` index above, with `isDeleted` and `isArchived` unset. `folderCards` rows carry no hidden marker, so each sample card is loaded and dropped when `isCardHidden` (`shared/tags.ts:30`) is true; titles of `secret`/`hidden` cards never reach Workers AI. The loop keeps reading until it has 5 visible samples or the folder runs out.
    - Each title is `cardDisplayTitle` (`card/displayTitle.ts:55`), the same helper the UI uses (link preview title, `metadataTitle`, file name, link host, then the first line), clipped to 120 characters.
    - Count every row read, hidden ones included, against a budget (40 folders × 10 rows); a folder that hits it goes with the samples it has.
  - `recordFolderSuggestion` (internal mutation, `{ guard, folderId, confidence, version }`). It checks the guard. It writes nothing when the card has gained a folder since, when it is dismissed, or when the folder is no longer eligible.
  - `dismissFolderSuggestion` (public mutation, `{ cardId }`) and `dismissFolderSuggestionForUser` (internal, for the API). Both clear `folderSuggestion` and set `folderSuggestionDismissed`, and are idempotent.
  - Add both internal functions to `workflowRpcAllowlist.ts`.
- `folder/membership.ts`: any path that adds a card to a folder (`setCardFoldersForUser`, `addCardsToFolder`, and the bulk add in `card/bulkActions.ts`) also clears `folderSuggestion`. Accepting is just "add to folder", so every surface clears it the same way.
- Deleting a folder needs no sweep. Readers check the folder (see Web), and the field is overwritten or cleared on the card's next folder change.

## Files Worker

- `packages/files-protocol`:
  - `FILES_OPS` gains `"decide-folder"`.
  - `DECISION_VERSIONS.folder` and `DECISION_THRESHOLDS.folder`.
  - `FilesFolderDecisionParams { card: { title?, summary?, tags: string[], host?, type }, folders: Array<{ key, name, samples: string[] }> }`.
  - `FilesFolderDecisionResult extends FilesDecisionFacts { decision: { key: string; confidence: number } | null }`.
  - `readFolderDecision(value, keys)`.
- `apps/files-worker/src/decisions.ts`:
  - `buildFolderRequest(params)`: model `clef`. The state is the card. One `choice` question named `folder`:
    - instructions: "Which of the person's folders would they file this saved item in? Choose none unless one clearly fits."
    - criteria: `{ none: "None of these folders clearly fits", f0: 'Folder "Design". It holds: "Brutalist web layouts", "Type specimen sites"…', … }`
  - `decideFolder(env, params)`: returns `decision: null` for `none` or below 0.8. Validate the input: 1–40 folders, unique keys, names of at most 300 characters (`MAX_FOLDER_NAME_LENGTH`, `shared/folders.ts:5`), at most 5 samples.
  - Dispatch it in `ops.ts`.
- `apps/files-worker/src/workflows/cardProcessing/decisions.ts`: `DecisionOp` gains `"decide-folder"`, and `DECISION_MODELS` maps it to `CLEF_MODEL_ID`.
- `run.ts`: append a step `"suggest folder"` after "transcribe podcast".
  - It runs only when `metadata?.mode === "completed"`. It runs the internal query; on `null` or no candidates it returns early. Otherwise it calls `runDecision` and maps the key back to a folder ID, then records the suggestion with the guard.
  - It is wrapped in `.catch` like the podcast step, so a failure never fails the card. It uses `NO_RETRY("1 minute")`, because a missed suggestion is harmless.
- Refresh details re-runs the workflow. The step re-decides unless the suggestion was dismissed.

## Web

- `CardMetadataPanel.tsx`, Folders row (425–454). When `cardFolders.length === 0`, the card is not deleted, and `card.folderSuggestion` resolves through `useFolders()` to an existing manual folder:
  - Below the "Add…" button, show a `FolderSuggestionChip`: `[FolderDot] Add to Design` as a ghost `Button` (size sm, `dir="auto"`, name truncated to one line at the panel width), then an `X` icon button labelled "Dismiss suggestion".
  - Accept: optimistically add the card to the folder (`addCardsToFolder`). The toast reads "Added to Design · Undo"; Undo removes the card from that folder.
  - Dismiss: optimistically hide the chip and call `dismissFolderSuggestion`. No toast.
  - A failure reverts the change, with the toast "Couldn't add to Design. Try again."
  - Keyboard: the chip and the dismiss button are in the panel's tab order, after "Add…". Enter accepts. No global shortcut.
- The card list and modal queries already return card fields. Add `folderSuggestion` to the card summary validators that the web reads (`card/queryUtils.ts`). Leave it out of `mobileCardSummaries.ts`.

## Extension

- `types/messages.ts`: `SaveDetailsResponse.card` gains `folderSuggestion?: { folderId, name, color }`. Add new messages `ACCEPT_FOLDER_SUGGESTION` and `DISMISS_FOLDER_SUGGESTION` (popup only, like `PATCH_CARD`).
- `lib/cardDetails.ts`:
  - Add `pollFolderSuggestion(cardId)`. It calls `GET /v1/cards/:id` at 2, 4, 7, 12 and 20 seconds, then every 15 seconds while the card is still processing (slow runs such as podcast transcription can take minutes). It stops as soon as the response carries a `folderSuggestion`, the card is in a folder, processing has finished without a suggestion, or the popup closes (an AbortSignal).
  - Add `acceptFolderSuggestion`, which calls `POST /v1/folders/{id}/cards` with `{ cardIds: [cardId] }`.
  - Add `dismissFolderSuggestion`, which calls `DELETE /v1/cards/{id}/folder-suggestion`.
- `SaveDetails.tsx`: below the note field, reserve no space until a suggestion arrives, then fade the chip in (150 ms).
  - Text: "Add to Design", with the folder dot and a dismiss X.
  - After accepting, the chip reads "Added to Design" with a check, and Undo (removes the card from the folder) for 5 s.
  - A card that was already saved shows its stored suggestion at once.
  - Errors appear inline in the existing `saveError` style: "Couldn't add to Design."
- The poll requests count against the API's limit of 120 per minute: five in the first 20 seconds, then at most four a minute while the popup stays open on a processing card. They go through phase 1's shared request counter, so they back off with the badge checks.

## API / MCP / SDK / CLI

- `serializeCard` and `serializeListCard`: `folderSuggestion: { folderId, folderName, folderColor, confidence } | null`. It is resolved against the folders table, and null when the folder isn't eligible any more.
  - The single-card path (`GET /v1/cards/{id}`, used by the popup's poll) passes the folder it read with `ctx.db.get(folderId)` into `serializeCard`, since the serializer has no database access of its own. The list serializer resolves folders through one per-request folder map, not one read per card.
- `DELETE /v1/cards/{cardId}/folder-suggestion`: 200 with the card. It is idempotent. Another user's card gets 404 and a trashed card 409. Route it in `parseCardRoute` beside `thumbnail`, and add the operation to `OPERATIONS_THAT_SEE_TRASHED_CARDS` (`publicApiHttpCards.ts:739`); otherwise the pre-handler check answers 404 for a trashed card before the handler can return 409.
- `publicApiOpenApi.ts`: the card schema field and the operation `dismissFolderSuggestion`.
- MCP: the field appears in card output. New tool `teak_v1_dismiss_folder_suggestion { cardId }`. Agents accept a suggestion with the existing `teak_v1_add_cards_to_folder`.
- SDK: `cards.dismissFolderSuggestion(id)` and the `Card` type field.
- CLI:
  - `teak cards get` prints "Suggested folder: Design (add with: teak folders add Design <id>)".
  - New command `teak cards dismiss-suggestion <id>`.
- `scripts/public-parity.ts`: a row for `dismissFolderSuggestion`.

## Docs

- `features.mdx` → Folders: a "Folder suggestions" paragraph. It explains when a suggestion appears (manual folders with 5+ cards), that nothing is filed without you, and how to dismiss one.
- The AI enrichment section: a line saying Clef sees your folder names and a few card titles, and that both stay inside Teak's Cloudflare account. Check the privacy policy's AI paragraph; no new processor is involved.
- The API, MCP and CLI docs, and the ship month's changelog: "Teak suggests a folder for new cards".

## UI states

- **None:** no suggestion. The Folders row looks as it does today.
- **Loading:**
  - In the popup the chip slot is empty while polling; no spinner, nothing jumps.
  - In the panel the chip appears reactively when the step finishes, if the modal is open.
- **One folder vs many:** the chip names one folder only. A 300-character name truncates with a `title` tooltip; RTL and CJK names use `dir="auto"`.
- **Stale:** a deleted or renamed folder is resolved live, so the chip shows the current name, or disappears if the folder was deleted.
- **Error:** the add reverts with a toast (in the panel) or inline text (in the popup).
- **Rate-limited:** a 429 when adding in the popup shows the existing `RATE_LIMITED` message.

## Scenario seed packs

- `folder-suggestions`:
  - **Folders:**
    - "Design" (12 design links), "Recipes" (8), "Reading list" (6) and "Sparse" (2 cards, so ineligible);
    - a smart folder `type:image`;
    - one 300-character folder name, one RTL name and one CJK name, each with 5 cards.
  - **Cards:**
    - one with a pending suggestion;
    - one dismissed;
    - one already in a folder;
    - one hidden (`#secret`);
    - one whose suggested folder is then deleted.
  - **Volume:** 60 eligible folders, to exercise the 40-candidate cap.

## Break-it checklist

- **UI:**
  - double-click Add, and Add then Undo then Add;
  - dismiss in one tab while another tab shows the chip;
  - accept, then delete the folder from the sidebar;
  - close the popup mid-poll;
  - save the same page twice;
  - keyboard only;
  - a 390 px panel.
- **Backend:**
  - Clef returns `none`, a low score, a key outside the list, a timeout or a capacity error;
  - the card gains a folder while the step runs (the guard plus the folder check);
  - a superseded run;
  - the AI gate denied;
  - 0, 1, 40 and 60 eligible folders;
  - another user's card ID on `DELETE …/folder-suggestion`;
  - native fixtures decoding a card with `folderSuggestion`.

## Tests

- `packages/files-protocol/src/decisions.test.ts`: `readFolderDecision` accepts the given keys and rejects unknown keys and bad probabilities.
- `apps/files-worker/src/decisions.test.ts`:
  - `buildFolderRequest` checks its input and builds the criteria, including `none`;
  - `decideFolder` applies the threshold and handles `none` (Workers AI mocked).
- `apps/files-worker/src/workflows/cardProcessing/run.test.ts`: the step is skipped when metadata did not complete, and records the suggestion when it did.
- `packages/convex/folderSuggestions.test.ts` (convex-test; add it to `vitest.config.ts`):
  - the candidate rules: 5+ cards, manual only, not deleting, the cap and sample order;
  - hidden, trashed and in-folder cards return null;
  - record and dismiss;
  - adding to a folder clears the suggestion.
- `packages/convex/__tests__/publicApiHttpCards.test.ts`: the serialized field, including null once the folder is deleted; the DELETE route; 404 and 409.
- `__tests__/mcp.test.ts`, `__tests__/sdk.test.ts`, `apps/cli/src/commands.test.ts`.
- `packages/ui/src/components/card-modal/__tests__/CardMetadataPanel.test.tsx`: the chip shows only with no folders and an existing suggested folder.
- `apps/extension/__tests__/cardDetails.test.ts`: polling stops on a suggestion, on a folder and on abort.
- e2e: `packages/tests/src/web/folder-suggestions.e2e.ts` (new) checks accepting and dismissing in the panel, against a seeded suggestion.

## Proof before the PR

- **Video 1:** save a design article from the extension. The chip appears in the popup; click it. Open the card on the web: it is in Design.
- **Video 2:** dismiss in the panel, then Refresh details; the chip stays away.
- **Screenshots:** the chip in the panel and the popup, the long, RTL and CJK names, and the error toast. Each in light and dark, at 390 and 1440 px.
- **Captured:** `GET /v1/cards/:id` with `folderSuggestion`, the DELETE call, and `teak cards get` output.

## Release gate

1. Run the narrow tests above, then the repo checks.
2. Seed `folder-suggestions`, run the break-it pass, and fix and add regression tests until it is clean.
3. Send the proof bundle to the owner.
4. Deploy the Files Worker first, then Convex and the web app, then release the extension through `apps/extension/release.md`.
5. There is no backfill: only new or refreshed cards get suggestions.
6. Smoke test: save a link that clearly fits a 5+ card folder, and see the chip.

## Risks And Open Questions

- **Many-option choice accuracy.** Clef's accuracy with 40 options is untested. Measure it on the dev library with 50 hand-labelled cards before merging, and lower the cap if precision at 0.8 is under 90%.
- **Open decision:** model `clef`, or the cheaper `clef-flash` (default: `clef`, about $0.0007 per card at roughly 3k input tokens).
- **Open decision:** the 40-folder cap and the 0.8 threshold (default: as written).
- **Open decision:** whether old cards with no folder should get a backfilled suggestion (default: no; Refresh details gives one).
- **Privacy:** folder names and sample titles go to Workers AI with the card. This is the same processor and account as today's tags, so no policy change is expected. Confirm the wording.
- **Popup polling** adds up to 5 API calls per save. If the badge (phase 1) and the polling together push users toward 120 requests per minute, switch the popup to one long-poll endpoint.
