# Card tiles in the grid

The web grid has one layout: a 16 px gap, columns at least 168 px wide and at most five. Notes, quotes, palettes and audio are uncaptioned 4:3 tiles with a gray border. Images and videos keep their shape, between 3:4 and 16:9, unframed and uncaptioned. Links and documents are framed cards with a footer row: an icon, the name, one short detail (a price, a file type) and the card's marks. No card shows a pin; the Pinned row hides the footer.

## Sub-features

- `tile-note` shows a note's first line as a 17 px heading (up to two lines) and the rest at 13 px, fading out at the bottom; a short note with no heading (80 characters or fewer) is set at 17 px. A clipped note names its site at the bottom. An empty note reads "Empty note".
- `tile-quote` sets a quote in the same sans at one size (17 px, up to four lines), after a red opening quote mark. A sourced quote names its site at the bottom.
- `tile-link` shows a link's preview image or screenshot in its own shape; wider than 1.4:1 is centered, taller keeps its top. Without an image, a gray cover shows the site's favicon (or a globe) and address. The footer shows the favicon, the name (the address until it has a title) and the price ("$79.00") when Teak read one. Notes and description are only in the card view.
- `tile-document` shows the first-page thumbnail on a gray ground, or a file icon and type without one. The footer shows a file icon, the file name and the type ("PDF").
- `tile-media` gives images and videos a faint edge so a white image doesn't melt into the page. A video shows a pill with a play icon and its length ("0:29") only while hovered and playing.
- `tile-palette` fills the tile with the palette's colors; a swatch widens and shows its hex code on hover.
- `tile-audio` shows the play button, the waveform and the length ("0:17"), with no name.
- `tile-marks` puts the favorite heart and the done check ("Marked as read", "Marked as bought"…) in small round chips at the end of a link's or document's footer, else in the card's bottom right corner. Hover never moves or hides them.
- `tile-states` covers the hover actions ("Open link", "Favorite", "More actions") top right and "Select" top left, the selection and focus rings (around the whole card, footer included), the processing bar along the bottom edge, and the faded card in Trash. The loading skeleton uses the same columns and gap.

## How to get to it (user POV)

- Web: Everything, any folder, Favorites, a search, or "Revisit" in the View menu (the deck shows the same tile, unframed). Dark mode follows Settings → Appearance or the system. The View menu has no density choice.

## Driving it with the e2e MCP server and the API

- **Seeded types.** Everything holds every type, including a video ("Find anything in Teak.mp4", 0:29), an audio ("Brand refresh voice memo.m4a", 0:17) and a PDF ("Teak search cheat sheet.pdf"). `observe` the grid: notes, quotes, palettes and audio have no footer text beyond their content; the PDF's card lists "Teak search cheat sheet.pdf" and "PDF"; the audio's lists "0:17" and no file name. At 1440 px with the sidebar open the grid has five columns; at 390 px, two.
- **Link covers.** With the API key from `scripts/api-key.ts`, `POST /v1/cards` with `{"content":"https://example.com/","tags":["verify-<run-id>"]}`. Search `#verify-<run-id>`: the cover shows a globe and "example.com", the footer "Example Domain" (or the address, before details arrive).
- **Processing.** Screenshot right after the `POST`: the card shows the processing bar for up to a minute.
- **Price.** A read price shows "$…" in the footer, before the marks. Dev rarely gets one; the footer's cases are in `Card.test.tsx`.
- **Done and favorite.** `POST /v1/cards/<id>/done` and `PATCH /v1/cards/<id>/favorite` `{"isFavorited":true}` on a marked link: its footer ends with the check and heart. On the web, done is the open card's `D` key, not a grid key. `F` on a note or image puts its heart in the bottom right corner.
- **Pinned.** `PATCH /v1/cards/<id>/pin` `{"isPinned":true}`: the card moves to "Pinned", with no footer or pin mark.
- **States.** `hover` for actions; `tap` "Select" for the selection ring; focus a card and press ArrowRight for the focus ring; `hover` the video for its pill. Screenshot each with 18 px around the card, since the select button sits outside it.

## Gotchas

- Link images load lazily and the grid adds cards in batches on scroll: scroll and wait before a screenshot or looking further down.
- The local stack (`bun run dev --local`) doesn't fetch link previews, so its links show their address as the title.
