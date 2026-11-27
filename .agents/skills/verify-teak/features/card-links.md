# Card links

Typing `[[` in a note links another card, stored as `[[Title|teak:<cardId>]]` and shown as a pill with the target's current title. An open card lists the notes linking to it under "Linked from"; the API, MCP, SDK and CLI return both directions.

## Sub-features

- `link-insert` types `[[`, picks a card from the menu (arrows, Enter, Esc), and saves a pill. A card whose title is the query is listed first, then titles that start with it.
- `link-pills` shows each pill with the target's live title, opens the target on click or Enter, and shows "Missing card" for a trashed, deleted or foreign target.
- `linked-from` lists the notes linking to the open card, up to 50 plus "and more"; a click opens one.
- `link-tiles` shows links as their titles on grid tiles and in search.
- `links-api` returns `links` and `backlinks` on `GET /v1/cards/:id`, in `teak_v1_get_card_links`, `cards.links` and `teak links <id>`, and leaves them out of the changes feed.

## How to get to it (user POV)

- Open a note (or the home page composer, or Focus; in native apps, Edit) → type `[[` → the "Link a card" list → pick a card ([apple](./apple.md) `apple-card-link-picker`, [android](./android.md) `android-card-link-picker`).
- Open any card → the side panel's "Linked from" section.
- `teak links <card-id>`, `GET /v1/cards/<card-id>`, the MCP tool `teak_v1_get_card_links`.

## Driving it with e2e MCP

Preconditions:

- Seed the packs on the signed-in account (local stack shown; on the dev deployment, drop the `env` prefix):
  - `env -u CONVEX_DEPLOY_KEY CONVEX_AGENT_MODE=anonymous bunx convex run devSeed:seedScenario '{"workosUserId":"<id>","scenario":"card-links"}'`
  - `env -u CONVEX_DEPLOY_KEY CONVEX_AGENT_MODE=anonymous bunx convex run devSeed:seedScenario '{"workosUserId":"<id>","scenario":"backlinks"}'`
- Pill titles and "Linked from" update within a second of a save.

Steps:

- **Insert.** In the composer, `type` "verify-<run-id> see " then "[[garden": the listbox "Link a card" shows "Garden plan". "ArrowDown"/"ArrowUp" move, "Enter" inserts a pill "Garden plan" in place of `[[garden`; "Meta+Enter" saves. "[[" then "Escape" closes the list and leaves `[[` as text. Inside a code block, `[[` opens no list.
- **Ranking and room for Save.** With cards "verify-<run-id>-1" and "verify-<run-id>-12.txt", `[[verify-<run-id>-1` lists "verify-<run-id>-1" first. While the list is open, the composer's "Save" stays uncovered and clickable (also at 390 px): the list stops above it, or opens above the caret when there's no room below.
- **Live title.** Rename the seeded "Garden plan" note's first line to "Garden plan 2026": your pill follows. After **Open**, rename it back for the next run.
- **Open.** `click` the pill (role link, name = the title): the dialog switches to "Garden plan 2026".
- **Missing.** `press` "/", `type` "#scenario-card-links", open "Broken links": the pills for the card in Trash, "Gone" and "Someone else's" read "Missing card". Restoring "Trashed target" brings its title back; trash it again afterwards.
- **Linked from.** `type` "#scenario-backlinks" with `replace: true`, open "Hub with 60 backlinks": the region "Linked from" lists 50 notes and "and more", including the archived source but not the one in Trash; `click` a row to open it.
- **Tiles.** In `#scenario-card-links`, the "Links to itself" tile reads "Links to itself: Me", with no `teak:` text. Search `garden plan` finds the note linking to it.
- **Copy text.** On a note with a pill, `press` "c" (or "Copy Text" in "More actions"): toast "Copied text", and the clipboard holds the pill's title, with no `[[` or `teak:` text (read it with `navigator.clipboard.readText()` in a Playwright context granted `clipboard-read`).
- **API, CLI, MCP.** With a minted key (`scripts/api-key.ts mint`): `curl -H "Authorization: Bearer $TEAK_API_KEY" "$BASE/v1/cards/<hub-id>"` has 59 `backlinks` and `backlinksTruncated: false` for the 60-link hub (one source is in Trash), and 100 with `backlinksTruncated: true` for the 120-link card; `GET /v1/cards/changes?since=0` items have no `links` key. `TEAK_API_URL=$BASE TEAK_API_KEY=$TEAK_API_KEY bun apps/cli/src/index.ts links <hub-id>` prints "Linked from" lines; `--json` prints the four fields. MCP `teak_v1_get_card_links` returns the same.
- **End to end (local stack).** `bun run --cwd packages/tests e2e src/web/card-links.e2e.ts`.

## Gotchas

- A token naming another account's card never makes a backlink and shows "Missing card".
- A note tagged `secret` or `hidden` never shows under "Linked from" or in `backlinks`.
- A note indexes at most 500 linked cards for "Linked from"; later pills still render.
- A token inside code is not a link. "```code```" on one line is inline code, not a code block, so links after it still count: save that line, a blank line and a token through `POST /v1/cards`, and `GET /v1/cards/<id>` lists the target in `links`.
- Native apps show a title on tiles and a pill in the card, but the raw token in the Edit field; their `[[` picker uses the web's query, `cards:searchCardLinkSuggestions`.
- Bold or italic around a link keeps the note as literal Markdown, since the editor can't round-trip it.
