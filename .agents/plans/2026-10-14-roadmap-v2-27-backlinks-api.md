## Goal

Show which cards link to the open card ("Linked from") in its detail panel, and expose each card's outgoing links and backlinks through the public API, MCP, SDK and CLI. Phase 27 of the [roadmap v2](2026-10-14-roadmap-v2-00-roadmap.md).

## Depends on

- [Phase 26](2026-10-14-roadmap-v2-26-card-links.md) (`cardLinks` table, `syncCardLinks`, `getCardLinkTargets`, `cardDisplayTitle`).

## Success Criteria

- The card detail panel has a "Linked from" section listing up to 50 cards that link to this card.
  - Each row shows a type icon and the current title. Clicking a row opens that card.
  - Beyond 50, the section ends with "and more". The panel fetches 50 + 1 rows, so it knows more exist but not how many.
  - The section is hidden when nothing links to the card. Trashed source cards are not listed.
- `GET /v1/cards/:id` (and the single-card responses of `PATCH`, favorite, restore and create) include:
  - `links: [{ id, title, type, missing }]`, which is this card's outgoing links in token order
  - `backlinks: [{ id, title, type }]`, the cards linking here, newest first
  - Each array holds at most 100 entries; `linksTruncated` and `backlinksTruncated` are booleans.
- MCP `teak_v1_get_card_links { id }` returns `{ links, backlinks, linksTruncated, backlinksTruncated }`.
- SDK `cards.links(id)` and CLI `teak links <id>` (`--json`) return both lists.
- OpenAPI documents both arrays.

## Context And Current Facts

- **`serializeCard`** (`publicApiHttpValidation.ts:105`) is a pure mapper. It's used by:
  - `GET /v1/cards/:id` (`publicApiHttpCards.ts:478`)
  - `PATCH`, at lines 582 and 612
  - the create response (`publicApiHttpValidation.ts:606`)
  - the **changes feed**, which maps every item through it (`publicApiHttpCards.ts:698`)

  Loading links for every card in a changes page would add two index reads per card.
- **OpenAPI.** `publicApiOpenApi.ts` defines `components.schemas.Card` (line 182). `CardsChangesResponse` reuses `Card` for its items, and `CardListItem` is a separate schema.
- **MCP.** `teak_v1_get_card` is defined in `mcp/tools.ts` (line 387, handler at line 984). Tool names follow `teak_v1_<verb>_<noun>`.
- **SDK.** `client/sdk.ts` has a `Card` type (line 63) and a `cards` namespace (line 708).
- **CLI.** `apps/cli/src/index.ts` registers commands with commander, both top-level (`ls`, `add`, `rm`, …) and under `cards`. Formatting lives in `format.ts`.
- **Detail panel.** `packages/ui/src/components/card-modal/CardMetadataPanel.tsx` renders the side panel (folders row at line 128). `ConnectedCardModal.tsx` provides the Convex data.
- Phase 26 marks trashed, deleted and foreign targets `missing` in `getCardLinkTargets`.

## Constraints And Non-goals

- Links are computed only for single-card responses. `serializeCard` gains an optional `links` argument. The changes feed and list items leave the arrays **absent**, not empty, and OpenAPI marks both as optional. Batch `GET /v1/cards/:id` calls when you need them.
- Ownership:
  - Backlinks come only from the caller's own cards: the rows are per user, and `userId` is checked again.
  - Outgoing links to foreign IDs never have rows (phase 26). Tokens are parsed from content and resolved through `getCardLinkTargets`, so foreign or unknown IDs appear as `missing: true` with a `null` title and `type`.
- No graph view and no link counts in the grid.
- Public API order: `publicApi.ts` (internal query `getCardLinksForUser`), then `publicApiHttpCards.ts` (pass it to `serializeCard`), then `executePublicApiOperation` (unchanged route), then `publicApiOpenApi.ts`, then `mcp/tools.ts`, then `client/sdk.ts`, then `apps/cli/src/index.ts` plus `library.ts`.

## Backend

- `card/cardLinks.ts`:
  - `getCardLinksHandler(ctx, userId, cardId, { limit })` returns `{ links, linksTruncated, backlinks, backlinksTruncated }`:
    - `links`: `parseCardLinkIds(card.content)` resolved through the same projection as `getCardLinkTargets`
    - `backlinks`: `cardLinks.by_toCardId`, filtered to the user, with source cards that are not deleted, sorted by source `updatedAt` descending
  - Session query `getCardBacklinks({ cardId, limit })`, max 50 + 1, for the panel. It's re-exported from `cards.ts` as `cards:getCardBacklinks`.
  - Internal query `getCardLinksForUser({ userId, cardId })`, limit 100, for the API.
- `publicApiHttpValidation.ts`: `serializeCard(card, url, extras?)` spreads `links` and `backlinks` only when `extras` is given.
- `publicApiHttpCards.ts`: GET, PATCH, favorite and restore run `getCardLinksForUser` after loading the card. The create response does too (`links` from content, `backlinks: []`).
- Analytics: `card_backlink_opened`.

## Web

- `CardMetadataPanel.tsx` gets a "Linked from" section below folders:
  - a quiet label
  - `PanelButton` rows with a type icon and a truncated title
  - clicking a row opens that card (`?card=`)
  - "and more" as muted text when the query returned the 51st row
  - while loading, two skeleton rows, rendered only when phase 26 found any link rows; otherwise nothing
- `ConnectedCardModal.tsx` subscribes to `cards:getCardBacklinks` for the open card.
- Keyboard: rows are buttons in tab order after folders.

## API / MCP / SDK / CLI

- `components.schemas.Card` gains:
  - `links?: CardLinkRef[]` and `backlinks?: CardLinkRef[]`
  - `linksTruncated?` and `backlinksTruncated?`
  - `CardLinkRef = { id, title: string | null, type: string | null, missing: boolean }`
- MCP `teak_v1_get_card_links`:
  - input `{ id }`
  - calls the GET card operation and returns only `{ links, backlinks, linksTruncated, backlinksTruncated }`
  - description: "Cards this card links to with [[…]] and cards that link to it."
- SDK:
  - `cards.links(id)` uses `GET /v1/cards/:id` and picks the fields
  - the `Card` type gains the optional fields
- CLI `teak links <id>`:
  - two sections, "Links" and "Linked from", one card per line as `<id>  <type>  <title>`, with `(missing)` where it applies
  - `--json`
  - exit code 1 for an unknown card, as `teak get` does

## Docs

- `features.mdx` "Link cards": the "Linked from" section.
- `(developers)/api.mdx`: `links` and `backlinks` on single-card responses, and their absence in the changes feed.
- `mcp.mdx`: the new tool. `(apps)/cli.mdx`: `teak links`.
- The ship month's changelog: "See which cards link to a card".

## UI states

- Empty: the section is hidden. The API returns empty arrays, and the CLI prints "No links."
- Loading: two skeleton rows, only after the first link exists.
- One item / many items: 1 backlink, and 60 backlinks (50 rows plus "and more").
- Very long names: titles truncate to one line with a tooltip; RTL titles align correctly.
- Error: on a failed query, the section is hidden and the error is logged, not shown.
- Rate-limited: API calls follow `publicApiRequests` (120 per minute) and return the usual `429` body. The CLI prints the retry hint.

## Scenario seed packs

- `backlinks`:
  - a hub card with 60 backlinks, and a card with 120 backlinks (API truncation)
  - backlinks from trashed and archived cards (archived listed, trashed hidden)
  - a cycle A→B→A, and a self-link (ignored)
  - a card linking to a hard-deleted ID and a foreign ID
  - 300-character, emoji, RTL and CJK source titles
- Built on the phase 26 `card-links` pack.

## Break-it checklist

- UI:
  - open a backlink row and go back and forward through the history
  - edit the source note in another tab to remove the link (the row disappears live)
  - trash the source card, then restore it
  - check at 390px (the panel is a sheet) with keyboard only, in dark mode
- API:
  - another user's card ID returns `404`
  - a trashed card's GET still shows its links
  - the changes feed has no `links` key
  - truncation at 100
  - bad IDs, a missing auth header
- MCP: unknown ID, foreign ID. CLI: `--json` against an unknown ID, and no auth.

## Tests

- `packages/convex/cardLinks.test.ts` (extend): ordering, ownership filter, trashed sources hidden, the 50 + 1 limit, `missing` resolution.
- `packages/convex/__tests__/publicApiHttpCards.test.ts`: GET and PATCH include the arrays, the changes feed omits them, truncation flags.
- `packages/convex/__tests__/publicApiHttpValidation.test.ts`: `serializeCard` with and without extras.
- `packages/convex/__tests__/mcp.test.ts` and `sdk.test.ts`: the new tool and method.
- `apps/cli/src/commands.test.ts`: `teak links` text and JSON output, exit codes.
- `packages/ui/src/components/card-modal/__tests__/CardMetadataPanel.test.tsx`: section hidden at 0, rows, "and more" at 51 backlinks and not at 50.
- `packages/tests/src/web/card-links.e2e.ts` (extend): the "Linked from" row opens the source card.
- `packages/tests/src/journey/03-api.e2e.ts`, `04-cli.e2e.ts` and `05-mcp.e2e.ts`: one links assertion each.

## Proof before the PR

- Video 1: link three notes to one card, open it, see "Linked from", and click through.
- Video 2: remove a link in one tab while the target is open in another (the row disappears), then trash the source.
- Screenshots: the panel with 1 and 60 backlinks, and a long title, in light and dark, at 390px and 1440px.
- A captured `GET /v1/cards/:id` with both arrays, a changes-feed page without them, `teak_v1_get_card_links` output and `teak links <id>` output.

## Release gate

1. Run the narrow tests above, then the repo checks, `card-links.e2e.ts`, `03-api.e2e.ts`, `04-cli.e2e.ts` and `05-mcp.e2e.ts`.
2. Seed `backlinks`, run the break-it pass, and fix with regression tests.
3. Send the proof bundle.
4. Open the PR, get CI green, and merge. Deploy Convex, then web. The CLI and SDK ship with the next lockstep release (`apps/cli/AGENTS.md`). No backfill and no worker change.
5. Smoke-test production: `teak links` on a test card that has links, and the panel on the web.

## Risks And Open Questions

- The owner's decision says the arrays live "on card JSON (`serializeCard`)". Putting them on every `serializeCard` call would make the changes feed cost two extra reads per card. Proposed: single-card responses only, documented in the API docs. The owner should confirm.
- Native apps (phases 29 and 31) can call `cards:getCardBacklinks` later; phase 29 only shows outgoing pills.
