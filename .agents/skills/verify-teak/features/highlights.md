# Highlights

In a link's **Read** tab on the web, selecting text shows **Highlight** (a bottom bar on touch); clicking it or pressing `H` paints the passage. Clicking a highlight opens its note, and the details panel lists the highlights in article order. Imports bring highlights, and the API, MCP, SDK and CLI list, add by quote, note and remove them.

## Sub-features

- `highlight-create` shows **Highlight** (`H` hint) over a selection in the article body (not header, title or footer); the button or `H` makes it, `Esc` drops the selection; a quick double `H` makes one. A selection starting or ending mid-word takes the whole word ("…(Germ" saves "…(Germany"), in any script.
- `highlight-touch` uses a bottom bar and a bottom sheet for the note on touch or under 768 px.
- `highlight-note` opens a popover note field ("Add a note", up to 2,000 characters, a count past 1,800) that saves on blur, `⌘↵`/`Ctrl+Enter` or closing; **Remove highlight** removes it with an **Undo** toast.
- `highlight-merge` merges a selection overlapping highlights into one (toast "Merged with an existing highlight", older note kept); the same passage twice is one highlight.
- `highlight-limits` refuses a quote past 5,000 characters ("Highlights can be up to 5,000 characters"); at 200 the button is disabled with "This card has 200 highlights, the most it can hold"; past 120 writes a minute "Too many changes. Try again in a moment."; a failed write rolls back with "Couldn't save the highlight. Try again."
- `highlight-panel` lists "Highlights · N" after Notes, quotes clamped to 3 lines, notes below; a click switches to Read, scrolls (not smoothly with reduced motion) and flashes it for 200 ms; ⋯ → Remove; "Not found in the saved article" or "Waiting for the article…" items aren't buttons.
- `highlight-freeze` keeps a highlighted link's saved copy and article on Refresh details and on a re-save with a page snapshot; a URL edit answers `409 CONFLICT` until the highlights are removed (on purpose).
- `highlight-import` turns Instapaper's Selection, Omnivore's `highlights/<slug>.md` blocks (notes included) and Raindrop.io's `highlights` column into highlights, unanchored until the article is saved; Teak archives carry `highlights` in `cards.json` and `cards.csv`.
- `highlight-api` serves `GET`/`POST /v1/cards/<id>/highlights` (`NO_ARTICLE`, `QUOTE_NOT_FOUND`, `HIGHLIGHT_LIMIT`), `PATCH`/`DELETE /v1/highlights/<id>`, `highlightCount` on cards, MCP `teak_v1_list_highlights`/`create_highlight`/`update_highlight`/`delete_highlight`, the SDK's `highlights.*` and `teak highlights list|add|note|rm`.

## How to get to it (user POV)

- A saved article on **Read** → select a sentence → **Highlight** or `H`.
- `?` lists "Highlight the selection".
- Settings → Import & export → Import → Instapaper or Omnivore, with highlights in the file.

## Driving it with e2e MCP and the API

Preconditions:

- Seed `reader-mix`, wait for its articles (`GET /v1/cards?q=%23scenario-reader&include=metadata` shows `article.wordCount`), then `highlights-mix`:
  `env -u CONVEX_DEPLOY_KEY CONVEX_AGENT_MODE=anonymous bunx convex run devSeed:seedScenario '{"workosUserId":"<id>","scenario":"highlights-mix"}'`.
- Import fixtures: `packages/tests/src/web/import-fixtures/instapaper-highlights.csv` (50 rows, 49 with a selection) and `omnivore-highlights.zip` (20 items, 19 highlight files with notes and one malformed file that stays a note).

Steps:

- **Make one.** In "Mulch depth and soil moisture in small plots" (Read), drag-select "kept 31% more moisture in July" and press `H`: it is painted and the panel shows "Highlights · 2" (the pack's one plus this). A selection across the header and first paragraph offers only the body part. `Esc` hides the button, not the dialog.
- **Whole words.** Highlight from "ept" of "kept" to "mois" of "moisture": the highlight and panel quote run "kept" to "moisture".
- **Note.** Click the painted words, type a note, click away, reload: the note is in the panel. Remove it: the toast's **Undo** brings it back.
- **Note across the save.** Press `H` and click the painted words before the write returns (throttle the network to widen the gap). The popover stays open as the highlight gets its saved id, and a draft typed meanwhile is saved to it. If another client merged it into a highlight with a note, an untouched field shows and keeps that note. Removing it elsewhere closes the popover; a later highlight over the same text doesn't reopen it.
- **Merge.** In the news story (12 highlights), select across two neighbouring highlights: they merge with the toast, and the count drops by one.
- **Cap.** In "The patient garden: a long read" (200 highlights), **Highlight** is disabled with the cap tooltip.
- **Panel.** In the long read's panel, Tab to an item, Enter: Read scrolls to and flashes it. "A page kept as text only" lists two imported highlights found after the article was saved and "A sentence that is in no article at all" with "Not found in the saved article".
- **RTL and CJK.** The Arabic and Japanese articles each show one highlight in place (the Japanese one merged from two).
- **Freeze.** On "Episode 12: The patient garden, with show notes", `archive.capturedAt` and `article` in `GET /v1/cards/<id>` are unchanged after **Refresh details** finishes. `PATCH /v1/cards/<id>` with a new `url` answers `409 CONFLICT`.
- **Touch.** At 390 px, select text: a bottom bar offers **Highlight**; a tapped highlight opens a bottom sheet.
- **Import.** Import `instapaper-highlights.csv`: each card's panel says "Waiting for the article…" until its article is ready (forever on the local stack, which has no link fetcher; on dev they anchor or say "Not found in the saved article").
- **API and CLI.** `POST /v1/cards/<research id>/highlights` with `{"quote":"KEPT 31%  more moisture\nin july"}` answers `201` with the article's exact text; a quote not in it `422 QUOTE_NOT_FOUND`; a product card `409 NO_ARTICLE`; another account's id `404`. `bun apps/cli/src/index.ts highlights list <id>` prints `<id>  <quote>` lines, notes indented.
- Capture the button, popover, touch bar and sheet, panel (1, 12, unanchored items) and cap, light and dark, at 390 and 1440 px.

## Gotchas

- Highlights paint with the CSS Custom Highlight API; a browser without it only lists them in the panel and says once "Your browser can't show highlights in the text".
- Offsets index the reader's whitespace-collapsed text, which the server rebuilds from the Markdown, so API highlights land where the reader shows them.
- Highlights aren't searched or embedded; native apps don't show them in v3.
