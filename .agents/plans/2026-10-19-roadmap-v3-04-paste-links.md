## Goal

Paste a list of links into the web composer, one per line, and get one link card per line. Up to 100 links are saved in the background, past the rate limit, and the save stops cleanly at the free plan's cap. Phase 4 of the [roadmap v3](2026-10-19-roadmap-v3-00-roadmap.md).

## Depends on

- [Phase 3](2026-10-19-roadmap-v3-03-resave-bump.md): a link you already have is bumped to the top, not duplicated (owner decision: repeats use the re-save rule).

## Success Criteria

- **When the composer splits:** when every non-empty line is a single http(s) URL, it always saves one link card per line (owner decision: always split, no "keep as one note" choice). This needs at least 2 lines; leading `-`, `*`, `+` or `1.` / `1)` list markers are stripped. Anything else (prose, a mix of words and URLs, one URL) is saved as today.
- **The Save button** reads "Save 12 links" while the draft is a link list, and "Save" otherwise. ⌘/Ctrl+Enter does the same.
- **Limits:** at most 100 links per paste. With more lines, the button reads "Save first 100 links" and the toast says how many were left out.
- **The job runs on the server** and keeps going if the tab closes. A toast shows progress ("Saving links · 8 of 12"), then one of:
  - "Saved 12 links";
  - "Saved 9 links · 3 already in Teak, moved to the top";
  - "Saved 4 of 12 links · You've reached 200 cards", with an Upgrade action.
- **Repeats:** repeats inside the paste count once. Links already in Teak follow phase 3 (bumped and un-archived).
- **Native apps** are unchanged.

## Context And Current Facts

- **Composer:** `packages/ui/src/components/forms/AddCardForm.tsx`.
  - `submitTextCard` (around line 225) calls `createCard({...prepareNoteCapture(content), source: "web"})`, behind a "Saving note..." toast.
  - Limit toasts: `isCardLimitError` → `showUpgradeToast`, and `isRateLimitError` → "Too many cards created. Please wait a moment.".
  - The Save button is around line 363, with `SAVE_NOTE_KEYS`. Focus mode saves through `handleFocusSave` (around line 280).
  - Creation status comes from `api.auth.getCardCreationStatus`.
- **Type detection:** `packages/ui/src/components/text-editor/noteCapture.ts` `prepareNoteCapture` (line 59).
  - A single self-link paragraph becomes a bare URL.
  - More than one block becomes `type: "text"`.
  - So today a list of URLs on separate lines becomes one text note.
- **Server-side detection:** on the server, `extractUrlFromContent` (`shared/utils/linkDetection.ts:37`) takes only the first URL of untyped content.
- **Pasting:** the editor pastes plain text (`text-editor/README.md`: "Pastes use plain text"), and `linkOnPaste`/`autolink` are off (`markdownDocument.ts`, StarterKit `link` config). Pasted URLs arrive as text in paragraphs. The Markdown serializer may escape characters such as `_` inside them, so detection must read lexer tokens, not raw lines.
- **Limits:**
  - `cardCreation` is a token bucket of 30 per minute with 6 shards (`shared/rateLimits.ts:5–13`), spent per card in `authorizeCardCreation` (`card/quota.ts`). It throws `RATE_LIMITED` with `retryAt` (`quota.ts:44–48`).
  - The free cap is `FREE_TIER_LIMIT = 200` (`shared/constants.ts:280`), enforced in `ensureCardQuotaAvailable` and `insertCountedCard`.
- **Prior art:** import paces itself on `retryAt` (`dataImport.ts`, `createPendingBatch` around line 560). Bulk API create accepts 100 items, but each is refused once the bucket is empty (`publicApi.ts:812–862`, `MAX_BULK_ITEMS = 100` at line 86).

## Constraints And Non-goals

- **Web composer only,** including Focus mode. No API, MCP or CLI operation: they already have `POST /v1/cards/bulk` and stdin bulk.
- **No preview dialog and no checkboxes** (owner decision: always split).
- **One job per user at a time.** Starting a second while one runs adds it to a queue that holds one, and further pastes are refused with a toast: "Still saving your last links. Try again in a moment.".
- **Each card is created through `createCardForUserHandler`** with `source: "web"`. Phase 3's re-save rule and the URL key come for free.
- **New table:** `linkPasteJobs`. It is covered by account deletion and removed 7 days after the job finishes (a cron sweep).
- **Analytics:** `link_paste_saved { count, created, resaved, stoppedAtLimit }` in `shared/analytics.ts` first.

## Backend

- **`schema.ts`:** `linkPasteJobs`:
  - `userId`, `urls: v.array(v.string())` (at most 100);
  - `nextIndex`, `created`, `resaved`, `failed`;
  - `status: "running" | "done" | "stopped_at_limit" | "failed"`;
  - `createdAt`, `updatedAt`, `finishedAt?`;
  - `.index("by_user_status", ["userId", "status"])` and `.index("by_status_finished", ["status", "finishedAt"])`.
- **New `card/pasteLinks.ts`:**
  - **`startLinkPaste({ urls })`** (public mutation):
    1. Normalize: trim, `sanitizeExternalUrl`, drop unsafe entries (counted as `failed`), and collapse repeats by `urlKey`.
    2. Cap at 100.
    3. Refuse when a running job exists: `ConvexError { code: "PASTE_ACTIVE" }`.
    4. Insert the job, then run the first batch inline.
    5. Return `{ jobId }`.
  - **`processLinkPaste({ jobId })`** (internal mutation), creating up to 10 cards per run:
    - on success, it bumps `created` or `resaved` from phase 3's outcome;
    - `RATE_LIMITED` means it schedules itself at `retryAt` and stops this run;
    - `CARD_LIMIT_REACHED` ends the job with status `stopped_at_limit`;
    - any other error counts as `failed` and moves on;
    - after the last URL the status is `done`.
  - **`getLinkPaste({ jobId })`** (public query): the counts and status, owner-checked.
- **`crons.ts`:** a daily sweep deletes `linkPasteJobs` whose `finishedAt` is older than 7 days.
- **Account deletion:** `accountDeletionData.ts` `ancillaryPage` deletes the user's `linkPasteJobs`. Add it to the "complete stages" test.

## Web

- **`noteCapture.ts`:** `extractLinkList(markdown): string[] | null`.
  - Lex with `marked`. Accept only paragraphs and list items whose inline content is a single URL: plain text, a self-link, or an autolink. Each soft or hard line break inside a paragraph splits it.
  - Strip list markers; skip empty lines.
  - Return the URLs in order when there are 2 or more and every line qualifies; otherwise return `null`.
- **`AddCardForm.tsx`:**
  - Derive `linkList = extractLinkList(content)` on change, memoized.
  - **Button label:** "Save" stays the same when `linkList` is null. Otherwise it reads `Save ${n} links`, or "Save first 100 links" past 100. The width animates over 150 ms.
  - **On submit with a list:**
    1. Reset the draft and call `startLinkPaste`.
    2. Show a loading toast, "Saving links · 0 of n", fed by `useQuery(api.card.pasteLinks.getLinkPaste, { jobId })`.
    3. Swap it for the final toast (copy in Success Criteria).
  - **The final toast:**
    - with resaves, it adds "· 3 already in Teak, moved to the top";
    - with failures, "· 2 couldn't be saved".
  - **Errors:**
    - `PASTE_ACTIVE` restores the draft and shows "Still saving your last links. Try again in a moment.".
    - A free user at 200/200 gets the existing upgrade toast without starting a job.
  - No optimistic tiles: cards appear as the job creates them, through the reactive grid.
- **Focus mode** (`FocusEditor`) shares `submitTextCard`, so it gets the same label and behaviour.

## API / MCP / SDK / CLI

- None. `scripts/public-parity.ts` is unchanged: the new functions are session-only Convex functions, not public API.

## Docs

- `features.mdx`, under saving: "Paste a list of links, one per line, and Teak saves each as its own card (up to 100 at a time)."
- The month's changelog: "Paste a list of links to save them all".

## UI states

- **Empty draft:** no button, as today.
- **One URL:** "Save", and one link card, as today.
- **2–100 URLs:** "Save 12 links".
- **101+ URLs:** "Save first 100 links", and the final toast adds "· 37 left out (100 at a time)".
- **Mixed lines,** such as a URL with a word after it: "Save", and one note.
- **Long job** (100 links at 30 a minute takes about 3–4 minutes): the progress toast stays. If the page reloads, the toast is gone, but the cards keep arriving.
- **Card limit mid-job:** the final toast with Upgrade.
- **Rate-limited:** handled inside the job; the person never sees it.
- **Error:** a failed job shows "Couldn't save the links. Try again.", and the draft is not restored, since some cards may exist.

## Scenario seed packs

- **`paste-links`:** a free account with 195 cards, plus 10 link cards whose URLs (some archived) appear in the fixture paste lists.
- **Fixture paste texts** (in the e2e spec, not seeded):
  - 2 links;
  - 12 links in a bulleted list;
  - 100 and 140 links;
  - links with `_` and `)` characters;
  - IDN links;
  - links with blank lines between them;
  - a list where one line has trailing words;
  - the same link three times;
  - a `javascript:` line.

## Break-it checklist

- Double-press ⌘Enter: one job.
- Paste 100, close the tab, and reopen after 4 minutes: all 100 are saved.
- Paste while a job runs: the `PASTE_ACTIVE` toast, and the draft is kept.
- 195/200 cards, then paste 12: 5 saved, then the cap toast. The repeated links bump and don't count toward the cap.
- Two tabs paste different lists at once: one is refused.
- Offline submit: the mutation fails, and the draft comes back.
- A list in a code block, or a quote of URLs: not split (only paragraphs and list items).
- Keyboard only; 390px composer label width with "Save first 100 links".

## Tests

- `packages/ui/src/components/text-editor/__tests__/noteCapture.test.ts`: `extractLinkList` over every fixture text, including the negatives.
- `packages/convex/__tests__/card/pasteLinks.test.ts`:
  - dedupe by key;
  - the cap at 100;
  - a `RATE_LIMITED` reschedule (the limiter mocked at its boundary);
  - stopping at the card limit;
  - resaved counting;
  - `PASTE_ACTIVE`;
  - owner checks on `getLinkPaste`.
- `packages/convex/accountDeletionWorkflow.test.ts`: seed a `linkPasteJobs` row.
- `packages/ui` `AddCardForm` test: the label for 0, 1, 2 and 101 links.
- e2e: `packages/tests/src/web/paste-links.e2e.ts` (new). Paste 12 and wait for 12 tiles; paste 3 with 1 existing and see the resave toast.

## Proof before the PR

- **Video 1:** paste 12 links and watch the label become "Save 12 links", the progress toast, and the tiles arriving.
- **Video 2:** 195/200 cards, paste 12, and the cap toast with Upgrade.
- **Screenshots:** the button label states and the final toasts, in light and dark at 390px and 1440px.

## Release gate

1. Run the narrow tests, the repo checks and the new e2e spec.
2. Seed `paste-links`, run the break-it pass, and fix and add regression tests until it is clean.
3. Send the proof bundle to the owner.
4. Merge and deploy Convex, then web. Smoke-test pasting 3 links on production.

## Risks And Open Questions

- **Open decision (default: 100 per paste, 10 cards per mutation run).** 100 links at 30 a minute takes over 3 minutes, so the progress toast matters.
- **Open decision (default: one running job plus none queued).** The simplest rule. A second paste is refused, not queued.
- **Open decision (default: list items count, code blocks and quotes don't).** Pasting a bulleted list of links is common. A quoted list is more likely meant as a note.
- **Escaping.** Tiptap's Markdown serializer may escape characters in URLs, so detection works on lexer tokens and decodes entities (`decodeHtmlEntities`). Tests cover `_`, `*`, `(` and `)`.
