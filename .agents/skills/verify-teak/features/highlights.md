# Highlights

In a link's **Read** tab on the web, selecting text shows **Highlight** above it (a bar at the bottom on touch); clicking it or pressing `H` paints the passage in one color. Clicking a highlight opens its note (a popover; a bottom sheet on touch) with **Remove highlight** and an Undo toast. The details panel lists "Highlights · N" after Notes, in article order; clicking one jumps to it in Read and flashes it. Overlapping highlights merge, a highlighted link's saved copy and article are frozen, imports from Instapaper, Omnivore and Raindrop.io bring highlights, and the API, MCP, SDK and CLI list, add by quote, note and remove them.

## Sub-features

- `highlight-create` shows **Highlight** (with an `H` hint) over a selection inside the article body (not the header, title or footer); the button or `H` makes it, `Esc` lets go of the selection; selecting and pressing `H` twice quickly makes one highlight.
- `highlight-touch` shows a bottom bar with **Highlight** on touch or under 768 px, and opens the note in a bottom sheet.
- `highlight-note` opens a note field ("Add a note", up to 2,000 characters, a count past 1,800) that saves on blur, `⌘↵`/`Ctrl+Enter` or closing; **Remove highlight** removes it with an **Undo** toast.
- `highlight-merge` merges a selection overlapping highlights into one covering them all (toast "Merged with an existing highlight", the older note kept); the same passage twice is one highlight.
- `highlight-limits` refuses a quote past 5,000 characters ("Highlights can be up to 5,000 characters"); at 200 the button is disabled with "This card has 200 highlights, the most it can hold"; past 120 writes a minute "Too many changes. Try again in a moment."; a failed write rolls back with "Couldn't save the highlight. Try again."
- `highlight-panel` lists "Highlights · N" after Notes: quote clamped to 3 lines with a left rule, note below; a click switches to Read, scrolls (no smooth scroll with reduced motion) and flashes it for 200 ms; ⋯ → Remove; "Not found in the saved article" or "Waiting for the article…" items aren't buttons.
- `highlight-freeze` keeps a highlighted link's saved copy and article on Refresh details and on a re-save with a page snapshot; a URL edit answers `409 CONFLICT` until the highlights are removed.
- `highlight-import` turns Instapaper's Selection, Omnivore's `highlights/<slug>.md` blocks (notes included) and Raindrop.io's `highlights` column into highlights, unanchored until the article is saved, then found in it; Teak archives carry `highlights` in `cards.json` and a `highlights` column in `cards.csv`.
- `highlight-api` serves `GET`/`POST /v1/cards/<id>/highlights` (`NO_ARTICLE`, `QUOTE_NOT_FOUND`, `HIGHLIGHT_LIMIT`), `PATCH`/`DELETE /v1/highlights/<id>`, `highlightCount` on cards, MCP `teak_v1_list_highlights`/`create_highlight`/`update_highlight`/`delete_highlight`, the SDK's `highlights.*` and `teak highlights list|add|note|rm`.

## How to get to it (user POV)

- Open a saved article's card on **Read**, select a sentence, and choose **Highlight** or press `H`.
- `?` lists "Highlight the selection" under the open card's shortcuts.
- Settings → Import & export → Import → Instapaper or Omnivore, with a file that has highlights.

## Driving it with e2e MCP and the API

Preconditions:

- Seed `reader-mix`, wait until its articles are ready (`GET /v1/cards?q=%23scenario-reader&include=metadata` shows `article.wordCount`), then `highlights-mix`:
  `env -u CONVEX_DEPLOY_KEY CONVEX_AGENT_MODE=anonymous bunx convex run devSeed:seedScenario '{"workosUserId":"<id>","scenario":"highlights-mix"}'`.
- The import fixtures are `packages/tests/src/web/import-fixtures/instapaper-highlights.csv` (50 rows, 49 with a selection) and `omnivore-highlights.zip` (20 items, 19 highlight files with notes and one malformed file that stays a note).

Steps:

- **Make one.** Open "Mulch depth and soil moisture in small plots" (Read). Select "kept 31% more moisture in July" by dragging; **Highlight** appears above it. Press `H`: the passage is painted and the panel shows "Highlights · 2" (the pack's one plus this). Select across the header and the first paragraph: only the body part is offered. Press `Esc` with a selection: the button goes and the dialog stays.
- **Note.** Click the painted words: the popover opens. Type a note, click away, reload: the note is in the panel. Remove it from the popover: the toast offers **Undo**, which brings it back.
- **Merge.** In the news story (12 highlights), select across two neighbouring highlights: one highlight covers both, the toast says "Merged with an existing highlight", and the count drops by one.
- **Cap.** In "The patient garden: a long read" (200 highlights), select new text: **Highlight** is disabled with the cap tooltip.
- **Panel.** In the long read's panel, Tab to an item and press Enter: Read scrolls to it and flashes it. "A page kept as text only" lists two imported highlights found after the article was saved and "A sentence that is in no article at all" with "Not found in the saved article".
- **RTL and CJK.** The Arabic and Japanese articles each show one highlight in place; the Japanese one is the merge of two overlapping requests.
- **Freeze.** On "Episode 12: The patient garden, with show notes", note `archive.capturedAt` and `article` from `GET /v1/cards/<id>`, choose **Refresh details**, wait for processing, and read again: both are unchanged. `PATCH /v1/cards/<id>` with a new `url` answers `409 CONFLICT`.
- **Touch.** At 390 px, select text: a bar at the bottom offers **Highlight**; tap a highlight: a bottom sheet holds the note.
- **Import.** Import `instapaper-highlights.csv`: each card's panel says "Waiting for the article…" until its article is ready (the local stack has no link fetcher, so on it they wait; on the dev deployment they anchor or say "Not found in the saved article").
- **API and CLI.** `POST /v1/cards/<research id>/highlights` with `{"quote":"KEPT 31%  more moisture\nin july"}` answers `201` with the exact text; a quote not in it answers `422 QUOTE_NOT_FOUND`; a product card answers `409 NO_ARTICLE`; another account's id `404`. `bun apps/cli/src/index.ts highlights list <id>` prints `<id>  <quote>` lines with notes indented.
- Capture the button, the popover, the touch bar and sheet, the panel with 1, 12 and unanchored items, and the cap, in light and dark at 390 and 1440 px.

## Gotchas

- Highlights paint with the CSS Custom Highlight API; a browser without it lists them in the panel and says once "Your browser can't show highlights in the text".
- Offsets point into the reader's text with whitespace collapsed; the server computes the same text from the Markdown, so a highlight made through the API lands where the reader shows it.
- A URL edit on a highlighted link is refused on purpose: remove the highlights first.
- Highlights aren't searched or embedded, and the native apps don't show them in v3.
