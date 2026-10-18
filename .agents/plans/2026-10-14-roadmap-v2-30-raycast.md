## Goal

Bring similar-card search and done states to the Raycast extension. That means a Find Similar command and action backed by `like:`, `is:done` / `is:todo` filters, and new parameters on the Raycast AI tools. Phase 30 of the [roadmap v2](2026-10-14-roadmap-v2-00-roadmap.md).

## Depends on

- Phase 14 (`like:`, `mood:`, and `similarTo` in the API, shipped) and phase 15 (done states, `is:done` / `is:todo`, and the done field in the API).

## Success Criteria

- A new **Find Similar** command (view mode) takes a card ID or Teak card URL as an argument. It lists up to 20 cards most like that card, using the same list UI and actions as Search Cards.
- Every card row in Search Cards, Favorites and tag lists gains a **Find Similar** action (⌘⇧S) that pushes the same view.
- **Done states.**
  - Search Cards understands `is:done` and `is:todo`, and shows them as a filter.
  - The Filters section offers Done and To do.
  - Each row has a **Mark as Done / Mark as To Do** action (⌘⇧D) and a done accessory icon.
- **AI tools.**
  - `search-cards` gains `similarTo?: string` (a card ID), `done?: "done" | "todo"` and `mood?: string` (search images by mood). `done` is sent to the API as `q=is:done` / `q=is:todo`; phase 15 adds no `done` query parameter.
  - `update-card` gains `done?: boolean`, sent through `POST` / `DELETE /v1/cards/:id/done`.
  - `get-card` returns `completedAt`.
  - The `ai.instructions` text explains when to use each.
- `CHANGELOG.md` gets a new entry. The extension is published through the Raycast store process.

## Context And Current Facts

- **Commands.** `apps/raycast/package.json` has 9 commands: `quick-save`, `save-text`, `save-clipboard-url`, `save-selected-text`, `save-current-browser-tab`, `save-finder-selection`, `search-cards`, `favorites` and `tags`.
- **AI tools.** There are 7 AI tools:
  - `search-cards`, with input `favorited`, `limit`, `query`, `sort: "newest" | "oldest"`, `tag` and `type`
  - `get-card`, `get-recent`, `list-tags`, `save-card`, `favorite-card`
  - `update-card`, with input `cardId`, `addTags`, `removeTags` and `notes`
- **API.** Raycast talks to the public REST API through `src/lib/api.ts`. `searchCards` builds `/cards?…` with `buildCardsSearchParams`, and responses are parsed by `src/lib/apiParsers.ts`.
- **Filter parsing.** `src/lib/searchFilters.ts` parses `fav`, `trash`, `in:trash`, `type:`, `#tag`, `hue:`, `style:`, `#hex`, `after:`, `before:` and sort tokens. Any other `key:value` token is passed through as a query term, so `like:` and `is:done` already reach the server. There are just no chips, filters or explicit-filter state for them.
- **Card list.**
  - `src/components/CardListActions.tsx` has a Filters section (Filter by Type, Color and Tag; Sort Results with Newest and Oldest First; Clear Filters), a card section (View, Open URL, Open File, Open in Teak, Edit, Move to Trash) and a Copy section.
  - `CardsListCommand.tsx` hosts the shared list.
- **Tests** live in `src/__tests__/` (`searchFilters`, `api`, `apiResponses`, `cardDetailModel`, `cardListState`, …). Run them with `bun test src/__tests__ --isolate`. `createRaycastApiMock` provides the Raycast API mock.
- **Publishing.**
  - `ray publish` (`npm run publish`) opens a pull request to the Raycast store repository.
  - `package-lock.json` must stay in sync, because store CI runs `npm ci` (`apps/raycast/AGENTS.md`).
  - Versions are lockstep through `.agents/releases.md`.
  - `CHANGELOG.md` entries use `{PR_MERGE_DATE}`.
- **Docs.** `content/docs/(apps)/raycast.mdx` and `apps/raycast/README.md` list the commands and AI tools.

## Constraints And Non-goals

- No backend changes; everything needed ships in phases 14 and 15.
- Unknown values for the done field are tolerated, and a missing field means "not done".
- `Find Similar` uses `similarTo` when the API has it. Otherwise it falls back to `q=like:<id>`, so the order of the backend and extension releases doesn't matter.
- One primary action per row stays "View Card". The new actions go in the card section, after Edit.
- No `mood:` UI in the list. Mood stays an AI-tool parameter and a typed qualifier, because image search by mood needs the grid, which Raycast lists don't have.
- No new preferences.

## Raycast

- `package.json`:
  - a new command `find-similar`: title "Find Similar Cards", mode `view`, with a required text argument `card` ("Card ID or link")
  - tool descriptions updated
  - `ai.instructions` extended ("Use similarTo to find cards like a given card; done filters read, watched or bought states.")
  - an `ai.evals` entry for each new parameter
- `src/lib/searchFilters.ts`:
  - parse `is:done`, `is:todo` and `like:<id>` into `done` and `similarTo` fields
  - include them in `hasExplicitFilters` and `buildSearchText`
  - extract the card ID from a Teak URL (`?card=<id>`)
- `src/lib/api.ts` and `apiErrors.ts`: `buildCardsSearchParams` sends `similarTo` when it's set, and folds `done` and `mood` into `q` as `is:done` / `is:todo` and `mood:"…"`. A new `setCardDone(cardId, done)` calls `POST /v1/cards/:id/done` to mark done and `DELETE /v1/cards/:id/done` to undo, the contract phase 15 defines. Generic `PATCH /v1/cards/:id` does not accept a done field.
- `src/lib/apiParsers.ts`: parse the optional `completedAt` field (`number | null`).
- `src/find-similar.tsx`: resolves the argument, then renders `CardsListCommand` with `similarTo`, titled "Like: <card title>".
- `src/components/CardListActions.tsx`:
  - "Find Similar" (⌘⇧S) pushes the find-similar list
  - "Mark as Done" / "Mark as To Do" (⌘⇧D) is optimistic, with a failure toast
  - the Filters section gains "Done" and "To Do" items
- `src/components/CardDetail.tsx` and `lib/cardDetailModel.ts`: a "Done" metadata row.
- `src/tools/search-cards.ts`: new input fields, documented with JSDoc so Raycast AI reads them.
- `src/tools/update-card.ts`: `done?: boolean`.
- `src/tools/get-card.ts`: returns `done`.
- `CHANGELOG.md`: "## [Find Similar and done states] - {PR_MERGE_DATE}".
- `README.md`: the commands and tools lists.
- `metadata/`: a new screenshot of Find Similar.

## Docs

- `content/docs/(apps)/raycast.mdx`: the Find Similar command and action, Done filters and action, and the new AI-tool parameters.
- The ship month's changelog: a Raycast item.

## UI states

- Empty: Find Similar with no results shows "Nothing similar yet". `is:done` with no matches shows "No done cards".
- Loading: Raycast's `isLoading` on the list, keeping the previous results while the query changes.
- One item / many items: 1 similar card, and 20 with pagination stopped at 20.
- Very long names: Raycast truncates titles, and the "Like: …" navigation title is cut to 40 characters.
- Error:
  - an invalid card argument: "That isn't a Teak card ID or link."
  - a trashed, hidden or foreign card: the API's `404` maps to "Card not found."
  - a failed toggle: an "Couldn't update card" toast and the state rolls back
- Rate-limited: a `429` maps to the existing rate-limit toast with the retry time (`apiErrors.ts`).

## Scenario seed packs

- Reuse `similar-and-mood` and `done-states` from phases 14 and 15 on the dev deployment.
- Add `raycast-extras`: 5 near-duplicate links (strong similarity), a card with no neighbours, cards in every done state across link categories, a trashed card ID and a hidden card ID.

## Break-it checklist

- Find Similar:
  - a trashed card, a hidden card, another user's ID, a malformed URL
  - a card URL with extra query parameters
  - opening Find Similar from inside Find Similar (navigation stack)
- Done:
  - toggle quickly 5 times
  - toggle while signed out (the auth flow)
  - toggle with the API down
- AI: "find cards like the one about kerning", "what haven't I read yet?" and "mark it done" (tool confirmation shown).
- Filters: `is:done is:todo` together matches nothing, matching phase 15's rule, and the UI shows the empty state.

## Tests

- `src/__tests__/searchFilters.test.ts`: parsing `is:done`, `is:todo`, `like:` and Teak URL extraction, plus the `buildSearchText` round trip.
- `src/__tests__/api.test.ts`: `buildCardsSearchParams` sends `similarTo` and folds `done` and `mood` into `q`, the fallback to `q=like:`, and `setCardDone` builds `POST` / `DELETE /v1/cards/:id/done`.
- `src/__tests__/apiResponses.test.ts`: `completedAt` parsed when present, null and absent.
- `src/__tests__/cardDetailModel.test.ts`: the Done row.
- `src/__tests__/tools.test.ts` (new): the `search-cards` and `update-card` tools map their new inputs (API mocked with `createRaycastApiMock`).
- `npm run lint` (`ray lint`), `typecheck` and `build` pass headless.

## Proof before the PR

- Video 1, recorded in Raycast on macOS: Search Cards, then Find Similar (⌘⇧S), Mark as Done (⌘⇧D), then filter by Done.
- Video 2: Raycast AI asked "find cards like <title> that I haven't read", showing the tool calls and the results.
- Screenshots: the Find Similar list, the empty state, the not-found toast and the detail Done row, in light and dark Raycast themes.
- `bun test` and `ray build` / `ray lint` output, and a captured `/v1/cards?similarTo=…&q=is:todo` request and response, and `POST /v1/cards/:id/done`.

## Release gate

1. Run `bun run --cwd apps/raycast test`, `typecheck`, `lint` and `build`.
2. Run the break-it pass against the dev deployment, and fix with regression tests.
3. Send the proof bundle.
4. Open the PR, get CI green, and merge.
5. Release: `bun run release:prepare <next patch>` (`.agents/releases.md`, which syncs `apps/raycast/package-lock.json`), merged to `main`. Then from `apps/raycast`, run `npm run publish` (`ray publish`), which opens the Raycast store pull request. Answer the store review, and confirm the store listing shows the new command after the merge.
6. Smoke-test after the store merge: install from the store, sign in, and run Find Similar and Mark as Done against production.

## Risks And Open Questions

- The API names for `similarTo`, `done` and `mood` are fixed by phases 14 and 15, which haven't been written yet. Adjust the parameter names to match, and keep the `q=` qualifier fallback.
- Raycast store review can take days. The extension must keep working with the backend as it is, and it does: both features are server-side qualifiers.
