# Card links

A user types `[[` in a note to link another card. The link is stored as `[[Title|teak:<cardId>]]` and shows as a pill with the target's current title; clicking it opens that card. A link to a card in Trash, a deleted card or another account's card shows "Missing card". Opening a card lists the notes that link to it under "Linked from". The API, MCP, SDK and CLI return a single card's `links` and `backlinks`.

## Sub-features

- `link-insert` types `[[`, picks a card from the menu (arrows, Enter, Esc), and saves a pill.
- `link-pills` shows each pill with the target's live title, opens the target on click or Enter, and shows "Missing card" for a trashed, deleted or foreign target.
- `linked-from` lists the notes linking to the open card, up to 50 plus "and more", and opens one on click.
- `link-tiles` shows links as their titles on grid tiles and in search.
- `links-api` returns `links` and `backlinks` on `GET /v1/cards/:id`, in `teak_v1_get_card_links`, `cards.links` and `teak links <id>`, and leaves them out of the changes feed.

## How to get to it (user POV)

- Open a note (or the home page composer, or Focus) → type `[[` → the "Link a card" list → pick a card.
- Click a pill to open its card. Open any card → the side panel's "Linked from" section.
- `teak links <card-id>`, `GET /v1/cards/<card-id>`, the MCP tool `teak_v1_get_card_links`.

## Driving it with e2e MCP

Preconditions:

- Seed the packs on the signed-in account (local stack shown; on the dev deployment, drop the `env` prefix):
  - `env -u CONVEX_DEPLOY_KEY CONVEX_AGENT_MODE=anonymous bunx convex run devSeed:seedScenario '{"workosUserId":"<id>","scenario":"card-links"}'`
  - `env -u CONVEX_DEPLOY_KEY CONVEX_AGENT_MODE=anonymous bunx convex run devSeed:seedScenario '{"workosUserId":"<id>","scenario":"backlinks"}'`
- The link rows are rebuilt just after each save; a pill's title and "Linked from" follow within a second.

Steps:

- **Insert.** Mark the run: in the composer, `type` "verify-<run-id> see " then `type` "[[garden". The listbox "Link a card" shows "Garden plan". `press` "ArrowDown"/"ArrowUp" to move, `press` "Enter" to insert: a pill "Garden plan" replaces `[[garden`. `press` "Meta+Enter" to save. `type` "[[" then `press` "Escape": the list closes and `[[` stays as text. Inside a code block, `[[` opens no list.
- **Live title.** Open the seeded "Garden plan" note, change its first line to "Garden plan 2026", close it. Open the note you made: the pill reads "Garden plan 2026". After **Open** below, change "Garden plan 2026" back to "Garden plan" so the next run finds the seeded title.
- **Open.** `click` the pill (role link, name = the title): the dialog switches to "Garden plan 2026".
- **Missing.** `press` "/", `type` "#scenario-card-links", open "Broken links": the pill for the card in Trash reads "Missing card", and so do "Gone" and "Someone else's". Restore "Trashed target" from Trash: its pill shows "Trashed target" again. Move it back to Trash so the next run starts from the seeded state.
- **Linked from.** `type` "#scenario-backlinks" with `replace: true`, open "Hub with 60 backlinks": the region "Linked from" lists 50 notes and "and more"; the archived source is listed, the one in Trash isn't. `click` a row: that note opens.
- **Tiles.** In `#scenario-card-links`, the "Links to itself" tile reads "Links to itself: Me", with no `teak:` text. Search `garden plan`: the note linking to it is found by the title.
- **API, CLI, MCP.** With a minted key (`scripts/api-key.ts mint`): `curl -H "Authorization: Bearer $TEAK_API_KEY" "$BASE/v1/cards/<hub-id>"` has 59 `backlinks` and `backlinksTruncated: false` for the 60-link hub (one source is in Trash), and 100 with `backlinksTruncated: true` for the 120-link card; `GET /v1/cards/changes?since=0` items have no `links` key. `TEAK_API_URL=$BASE TEAK_API_KEY=$TEAK_API_KEY bun apps/cli/src/index.ts links <hub-id>` prints "Linked from" lines; `--json` prints the four fields. The MCP `teak_v1_get_card_links` returns the same.
- **End to end (local stack).** `bun run --cwd packages/tests e2e src/web/card-links.e2e.ts`.

## Gotchas

- Links are only to your own cards; a token naming another account's card never makes a backlink and shows "Missing card".
- A note tagged `secret` or `hidden` never shows under "Linked from" or in `backlinks`.
- A note indexes at most 500 linked cards for "Linked from"; later pills still render.
- Native apps (Mac, iPhone, iPad) show the link as its title on tiles but the raw token inside the note.
- Bold or italic around a link keeps the note as literal Markdown, as with other syntax the editor can't round-trip.
