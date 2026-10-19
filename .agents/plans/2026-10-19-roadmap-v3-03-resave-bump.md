## Goal

When you save a link you already have, Teak moves that card to the top of "Newest first" and brings it back from Archive, instead of quietly doing nothing or making a second card. A new `savedAt` time drives the order, and `createdAt` stays the date you first saved it. Phase 3 of the [roadmap v3](2026-10-19-roadmap-v3-00-roadmap.md).

## Depends on

- [Phase 2](2026-10-19-roadmap-v3-02-url-key.md): the match uses `urlKey`.

## Success Criteria

- **Every save path, through one server rule in `createCardForUserHandler`:** the web composer, the share sheets (iPhone, iPad, Mac, Android), email-in, `POST /v1/cards`, bulk create, MCP, CLI and Raycast.
- **What happens on a match.** When a save would create a link card whose `urlKey` matches a live card (not in Trash), Teak creates nothing. It instead:
  - sets the existing card's `savedAt` (and `updatedAt`) to now;
  - un-archives it if it was archived;
  - returns its id.
- **What is not merged.** Tags, notes or text sent with the save are not merged into the card (owner decision). A trashed match is ignored, and a new card is created as today.
- **Order and dates:**
  - "Newest first" and "Oldest first" order by `savedAt`, everywhere a list is ordered by date: the library, archive, favorites, folders, smart folders, tags, sites, search with a date sort, the API, MCP, CLI and the native apps' server-sorted lists.
  - The card details show "Added <first date>" from `createdAt`, plus "Saved again <date>" when `savedAt` is later.
- **What clients are told:**
  - `POST /v1/cards` returns `status: "created"` with `resaved: true` and the card.
  - The web toast says "Already in Teak · Moved to the top", with an Open action.
  - The extension and Raycast show "Already in Teak" and the card moves.
- **Compatibility:**
  - The native apps keep working without an update. The `createCard` mutation still returns an id.
  - `/v1/cards/changes` reports the bump through `updatedAt`.

## Context And Current Facts

- **Sort today:**
  - `shared/search/sort.ts` `compareCardsByCreatedAt` (lines 20–29) orders by `createdAt`, then `_creationTime`. It is used in `card/getCards.ts`, `card/listQuery.ts`, `card/visualFilters.ts` and `shared/search/localSearch.ts`.
  - `createdAt` is set once, at insert (`card/createCard.ts`, `createdAt: options.importedVisibleFields?.createdAt ?? now`), or to the imported date.
- **Every date-ordered index is keyed on a copy of `createdAt`:**
  - **`cards`** (`schema.ts:636–686`), read by `card/listQuery.ts:142–235`:
    - `by_created`;
    - `by_user_deleted_created`;
    - `by_user_deleted_archived_created`, also read by `card/cardLinks.ts`;
    - `by_user_deleted_archived_type_created`;
    - `by_user_deleted_archived_favorited_created`;
    - `by_user_deleted_archived_host_created`.
  - **`folderCards.cardCreatedAt`** (`schema.ts:795`), read by `listQuery.ts:260–267`:
    - `by_folderId_and_isDeleted_and_isArchived_and_cardCreatedAt`;
    - `by_folderId_and_isDeleted_and_cardCreatedAt`.
  - **`cardSearchTags.cardCreatedAt`** (`schema.ts:1048`), read by `listQuery.ts:311–356`:
    - `by_user_tag_deleted_created`;
    - `by_user_tag_deleted_archived_created_v2`;
    - `by_user_tag_deleted_archived_type_v2`;
    - `by_user_tag_deleted_archived_favorited_v2`;
    - `by_user_tag_deleted_archived_type_favorited_v2`.
- **Date words** ("last week", "january") become `createdAtRange` (`card/getCards.ts:119,188`), bounded on the same indexes (`listQuery.ts:121–123`).
- **What each surface does with a duplicate today:**
  - **Always insert:** `createCardForUserHandler` (`card/createCard.ts:167`), the public `createCard` mutation (line 305, returns `v.id("cards")`), `raycast.quickSaveForUser` (`raycast.ts:349`, behind `POST /v1/cards`, result validator `status: v.literal("created")` at line 63), bulk create (`publicApi.ts:862`) and email-in (`inbound/ingest.ts:151`).
  - **Check first, then show "already saved" without writing:**
    - the Chrome and Firefox extension: `apps/extension/lib/saveToTeak.ts:114–125`;
    - Raycast: `apps/raycast/src/lib/capture.ts:165` `showIfAlreadySaved`;
    - Safari: `apps/apple/SafariExtension/Resources/popup.js:72`, through the `findDuplicateCard` query.
  - **Import** skips duplicates (`dataImport.ts:554–600`).
- **Details panel:** `packages/ui/src/components/card-modal/cardDetails.ts:63` shows "Added" from `createdAt`.
- **Native apps:** they decode `createdAt`, falling back to `_creationTime` (`apps/apple/.../Models/Card.swift:331`). They pass `createdAtRange` (`LibraryQuery.swift:219`) and don't sort lists themselves.

## Constraints And Non-goals

- **Fields:**
  - `cards.savedAt: v.optional(v.number())`.
  - The copies: `folderCards.cardSavedAt` and `cardSearchTags.cardSavedAt`.
  - Readers use `savedAt ?? createdAt` until the backfill finishes.
- **New indexes go beside the old ones** (`.agents/feature-conventions.md`): 6 on `cards`, 2 on `folderCards` and 5 on `cardSearchTags`. Each has the same fields with `savedAt` in place of `createdAt`. The old ones are dropped in a later PR.
- **Ships as two PRs within this phase,** because readers can't switch until every row has the new field:
  - **3a:** add the fields and indexes, write `savedAt` on insert (equal to `createdAt`) and keep the copies in sync, plus the backfill.
  - **3b,** after the production backfill: move every reader, add the re-save rule and the UI.
- **Import keeps skipping duplicates.** An import doesn't bump a card, so importing an old export never reshuffles the library.
- **When the rule applies:**
  - Only when the save would produce a `link` card from a bare URL: the `url` field, or content that is only a URL.
  - Content with other text, uploads, text cards and quotes are created as today.
- **Limits:** a re-save spends one `cardCreation` rate-limit token. It doesn't count toward the 200-card cap, so a free user at the cap can still bump.
- **Analytics:** add `card_resaved { surface, wasArchived }` to `shared/analytics.ts` first.

## Backend

### 3a: fields, indexes and backfill

- `schema.ts`:
  - `savedAt` on `cardValidator`;
  - `cardSavedAt` on `folderCards` and `cardSearchTags`;
  - the 13 `…_saved` indexes beside their `…_created` twins.
- **Writes:**
  - Every production card insert sets `savedAt` to the same value as `createdAt`: `insertCountedCard` (`card/cardUsage.ts:414`) fills it when missing, which covers `createCardForUserHandler` and `card/uploadCard.ts:295`; `card/defaultCards.ts:409` (onboarding) and `devSeedLinks.ts:55` insert directly and set it themselves. A test asserts each path writes it, since a card without `savedAt` would drop out of the `…_saved` indexes.
  - Folder-row sync (`syncCardFolderRows`) and tag-row sync (`restartCardSearchTagSync`) copy `savedAt ?? createdAt` into `cardSavedAt`. The tag-sync snapshot kept in `cardSearchTagSyncStates` (`schema.ts:1098`) records it too, and its "has anything changed" comparison includes it, so a bump alone re-syncs the tag rows.
- **New `migration/backfillSavedAt.ts`:**
  - pages `cards` and sets `savedAt = createdAt` where it is missing;
  - pages `folderCards` and `cardSearchTags`, filling `cardSavedAt` from the card;
  - dry run by default, with the account-deletion gate.

### 3b: readers and the rule

- **Readers:**
  - `card/listQuery.ts` switches every `withIndex` to its `…_saved` twin, with bounds on `savedAt`.
  - `compareCardsByCreatedAt` becomes `compareCardsBySavedAt`, using `savedAt ?? createdAt`, in its four callers.
  - Date words bound `savedAt`; the `createdAtRange` argument name stays for client compatibility. Every card-level date predicate and post-filter uses `savedAt ?? createdAt` too, not only the index bounds: `card/getCards.ts`, `card/queryUtils.ts`, `card/visualFilters.ts`, `publicApiSearch.ts` and the local cache's `shared/search/localSearch.ts` (both its date filter and its ordering), or a re-saved card would drop out of "last week".
  - Pagination anchors move with the order: `publicApiCursors.ts` encodes `savedAt ?? createdAt` (as `savedAt`) beside the id, and still decodes an old cursor's `createdAt` as the anchor value, so a cursor issued before the deploy keeps working. The folder and tag page cursors do the same.
  - `card/cardLinks.ts` moves too.
- **The rule (`card/createCard.ts`):**
  - Before inserting, when `type` resolves to `link` and the content is only the URL:
    1. Look up a live card by `urlKey`, using phase 2's helper.
    2. On a hit, `patchCardWithSearchSync(ctx, id, { savedAt: now, updatedAt: now, ...(archived ? { isArchived: undefined, archivedAt: undefined } : {}) })`.
    3. Re-sync folder and tag rows so `cardSavedAt` follows.
    4. Return `{ cardId, outcome: "resaved" }`.

    The lookup runs after `authorizeCardCreation` (which spends the rate-limit token but does not check the cap) and before `insertCountedCard` (which enforces the 200-card cap), so a re-save at the cap succeeds. The web composer still disables saving at the cap from `getCardCreationStatus`, since it can't know in advance that a link is already saved; the extension, share sheets and API re-save at the cap.
  - `createCardForUserHandler` returns `{ cardId, outcome: "created" | "resaved" }`.
  - Callers that need only the id (`createCard`, `publicApi.ts` bulk, `inbound/ingest.ts`) take `.cardId`.
  - The public `createCard` mutation still returns `v.id("cards")`, for the native apps.
  - A new public mutation, `createCardWithOutcome`, returns `{cardId, outcome}` for the web.
- **Raycast quick save:** `raycast.quickSaveForUser` keeps `status: "created"` and adds `resaved: true` on a re-save.
- **Processing:** a bumped card is not reprocessed.

## Web

- **`packages/ui/src/components/forms/AddCardForm.tsx`:**
  - `submitTextCard` calls `createCardWithOutcome`.
  - On `resaved`, the toast reads "Already in Teak · Moved to the top", with an "Open" action that opens the card modal. If the card was archived, it reads "Already in Teak · Moved back from Archive".
  - The optimistic card (lines 202–217) is removed when the outcome is `resaved`, so no ghost tile is left. The real card's `savedAt` change moves the tile through the reactive query.
- **`card-modal/cardDetails.ts`:**
  - "Added" stays `createdAt`.
  - A new "Saved again" row shows `formatCardDate(savedAt)` when `savedAt - createdAt > 60_000`.
- **Smart folders and the search box:** no change. Order follows `savedAt`.

## Extension, Raycast and Safari

- **Extension** (`apps/extension/lib/saveToTeak.ts`):
  - Drop the duplicate pre-check before `POST /v1/cards` for URL saves. The POST now bumps.
  - Map `resaved: true` to the existing `duplicate` outcome, so the popup shows "Already in Teak", now with the card moved.
  - The phase 1 badge still uses `GET /v1/cards/duplicate`.
- **Raycast:** `capture.ts` `showIfAlreadySaved` is replaced by the save's result. A `resaved: true` result shows the "Already saved" toast with "Moved to the top" as its message.
- **Safari:** `popup.js` drops its `findDuplicateCard` pre-check and calls `createCard`. A `resaved` result can't be seen through `createCard`'s id-only return, so it shows "Saved". This ships with the next Apple app build.

## API / MCP / SDK / CLI

- **`POST /v1/cards`:**
  - `status` stays `"created"`: the OpenAPI schema is `enum: ["created"]` (`publicApiOpenApi.ts:467`) and the SDK's `asCreate` (`client/sdk.ts:717`) throws `PARSE_ERROR` on any other value, so a new status would break every shipped SDK and CLI. A re-save adds `resaved: true` (and `wasArchived: true` when it un-archived the card) beside it. Old clients ignore the extra fields.
  - The response code stays 200, and idempotency replay returns the original response.
- **Tags and notes on a re-save** are ignored (owner decision). The API, MCP and CLI docs say so, and `resaved: true` in the response tells a caller to `PATCH` the card if it wants them applied.
- **Card schema:** `savedAt: number` in `serializeCard` and `serializeListCard` (`publicApiHttpValidation.ts`). `createdAt` keeps its meaning.
- **`GET /v1/cards`:** `sort=newest|oldest` follows `savedAt`. The OpenAPI description says so.
- **Bulk create:** a resaved item keeps `status: "created"` and adds `resaved: true`, with its `cardId`.
- **MCP:** `teak_v1_create_card` (or the current save tool name) returns the status, and its description explains re-save.
- **SDK:** `CreateCardResponse` gains optional `resaved` and `wasArchived`, and `Card.savedAt` is added. `asCreate` keeps requiring `status: "created"`.
- **CLI:** `teak save` prints "Already in Teak, moved to the top: <id>" when `resaved` is true. `cards get` prints "Saved again <date>".
- **Export:** `savedAt` goes in `cards.json` as a `DualTimestamp`. `SCHEMA_VERSION` stays 2; it is an additive field. The Teak archive importer reads it back through `importedVisibleFields` for the cards it creates (falling back to `createdAt` for older exports), so a round trip keeps the order; existing duplicates are still skipped, not bumped.

## Docs

- `features.mdx`: a "Saving something again" note, and the Date token row now reads "Date saved (or saved again)".
- `(developers)/api.mdx`: `resaved` and `savedAt`. Also `mcp.mdx` and `(apps)/cli.mdx`.
- `(apps)/extension.mdx` and `raycast.mdx`: what "Already in Teak" now does.
- The month's changelog: "Saving a link again moves it to the top".

## UI states

- **Re-save of a visible card:** the tile animates to the top (150–200 ms), with no flash of a duplicate tile.
- **Re-save of an archived card while viewing Archive:** the tile leaves Archive, and the toast says "Moved back from Archive".
- **Re-save while viewing a folder** the card isn't in: no visual change, and the toast's Open action still works.
- **Rate-limited:** the existing "Too many cards created…" toast.
- **Error:** the existing failure toast. The draft is restored.

## Scenario seed packs

- **`resave`:**
  - 300 link cards spread over 3 years, with a known `urlKey` set;
  - 20 archived matches and 5 trashed matches;
  - one card in 3 folders and tagged `reading`;
  - a card whose URL variant differs only by `utm_source`;
  - a free account at 200/200 cards.
- Add `ordering-saved`: cards whose `savedAt` and `createdAt` disagree, for testing ordering, date words and folder and tag lists.

## Break-it checklist

- **Concurrency:**
  - Re-save the same URL from two tabs at once: one bump, and no second card (OCC on the existing card).
  - Re-save inside a bulk request that also contains the same URL twice.
- **Matches:**
  - A trashed match makes a new card.
  - An archived match comes back.
  - A free user at the cap can still bump.
- **Content:** a URL with a note through `POST /v1/cards` (the note is ignored, as decided; see Risks), and text with a URL plus words (makes a new card).
- **Order and dates:**
  - Folder, tag, site and favorites views show the bumped card first.
  - `Oldest first` puts it last.
  - `last week` finds a card first saved last year but saved again yesterday.
- **Compatibility:**
  - Native apps (old builds) list in the new order, and their share sheets bump.
  - Idempotency-Key replay of a resave.
  - `/v1/cards/changes` shows the bumped card.

## Tests

- `packages/convex/__tests__/card/createCard.test.ts`:
  - bump, un-archive, trashed ignored;
  - a note or extra text creates a new card;
  - the cap is not counted, and the rate limit is spent.
- `packages/convex/cardListOrdering.test.ts` (Vitest, already listed): every list path orders by `savedAt`, and the fallback to `createdAt` before the backfill.
- `packages/convex/__tests__/shared/search/sort.test.ts` and `localSearch.test.ts`.
- `packages/convex/__tests__/migration/backfillSavedAt.test.ts`.
- `packages/convex/__tests__/publicApiHttpCards.test.ts`, `__tests__/mcp.test.ts`, `__tests__/sdk.test.ts`, `__tests__/export/serialize.test.ts`.
- `apps/extension/__tests__/lib/saveToTeak.test.ts`: `resaved` maps to duplicate, and no pre-check request is made.
- `apps/raycast/src/__tests__/capture.test.ts`.
- `packages/ui` `AddCardForm` test: the resaved toast with no optimistic tile left.
- e2e: `packages/tests/src/web/resave.e2e.ts` (new), plus `journey/03-api.e2e.ts` for `resaved: true` (and an old-SDK parse of that response).

## Proof before the PR

- **Video 1:** scroll to a card from last year, paste its URL in the composer, and watch it jump to the top with the toast.
- **Video 2:** an archived card saved again from the extension leaves Archive.
- **Screenshots:** the details panel with "Added" and "Saved again", and the toast, in light and dark at 390px and 1440px.
- **Captured requests:** `POST /v1/cards` returning `resaved`, the bulk mixed result, and `teak save` output.
- **Backfill:** dry-run and real-run totals on dev, plus Convex index-rebuild timings.

## Release gate

1. **PR 3a:** narrow tests, then the repo checks. Merge and deploy. The owner runs `backfillSavedAt` on production: the dry run, then pages. Watch database I/O (`.agents/convex-costs.md`).
2. **PR 3b:** narrow tests, the repo checks and e2e. Seed `resave` and `ordering-saved`, run the break-it pass, send the proof bundle. Merge, deploy, and smoke-test a re-save on production.
3. **Later PR:** drop the 13 `…_created` indexes the readers no longer use. `by_created` stays, since admin, export and backfills use it. Record each removal in `.agents/sunset.md`.

## Risks And Open Questions

- **Cost.** 13 new indexes and a backfill touching every card, folder row and tag row. A cheaper alternative needs no new index and no backfill: on re-save, write the old `createdAt` into a new `firstSavedAt` and set `createdAt` to now. Its catch is that `createdAt` in the API changes meaning. **Open decision (default: the owner's `savedAt` design as written; the alternative is offered for review).**
- **Open decision (default: tags, notes and extra text sent with a re-save are dropped).** The owner chose no merging. The extension and Raycast add tags and notes after the save with `PATCH`, so nothing is lost there. An API caller sending `notes` with a known URL loses them silently, and the `resaved` status is its only signal.
- **Open decision (default: imports never bump).** The owner said "everywhere", but importing an old export would otherwise reorder the whole library.
- **Open decision (default: date words filter by `savedAt`).** Keeping them on `createdAt` would need the old indexes forever.
- **Safari** can't tell "resaved" from "created" until a later Apple change adds an outcome to the share path.
