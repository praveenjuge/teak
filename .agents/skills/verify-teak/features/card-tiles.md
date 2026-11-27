# Card tiles in the grid

The web grid has one layout: a 16 px gap, columns at least 168 px wide and at most five, so a phone shows two columns. Notes, quotes, palettes and audio are 4:3 tiles with a gray border and no caption. Images and videos keep their own shape, held between portrait 3:4 and widescreen 16:9, with no frame and no caption. Links and documents are framed cards whose name sits in a footer row inside the frame: an icon, the name, one short detail (a price, a file type) and the card's marks. A favorite's heart and a done link's check sit in one spot on every card: its bottom right corner, or the end of that footer. No card shows a pin; the Pinned row hides the footer, so nothing in it has a caption.

## Sub-features

- `tile-note` shows a note's first line as a 17 px heading (up to two lines) and the rest at 13 px, fading out at the tile's bottom; a short note with no heading (80 characters or fewer) is set at 17 px. A note clipped from a page names its site at the bottom of the tile. An empty note reads "Empty note".
- `tile-quote` sets a quote in the same sans as everything else, at one size (17 px, up to four lines), after a red opening quote mark. A quote with a source names its site at the bottom.
- `tile-link` shows a link's preview image or screenshot in the picture's own shape; a picture wider than 1.4:1 is centered and a taller one keeps its top. A link without an image shows its site's favicon (a globe when there's none) and address on a gray cover. The footer shows the favicon, the name (the address when it has no title yet) and the price ("$79.00") when Teak read one. A link's notes and description aren't on the card; they're in the card view.
- `tile-document` shows the first page of a document with a thumbnail on a gray ground; one without a thumbnail shows a file icon and its type. The footer shows a file icon, the file name and the type ("PDF").
- `tile-media` shows images and videos without a border or caption, with a faint edge so a white image doesn't melt into the page. A video shows a pill with a play icon and its length ("0:29") only while the pointer is on it and it plays.
- `tile-palette` fills the tile with the palette's colors; a swatch widens and shows its hex code on hover.
- `tile-audio` shows the play button, the waveform and the length ("0:17"), with no name.
- `tile-marks` puts the favorite heart and the done check ("Marked as read", "Marked as bought"…) in small round chips: at the end of a link's or document's footer, else in the card's bottom right corner. Hover never moves or hides them.
- `tile-states` covers the hover actions ("Open link", "Favorite", "More actions") at the top right and "Select" at the top left, the selection ring and the keyboard focus ring (both around the whole card, footer included), the processing bar along the card's bottom edge while it's still being processed, and the faded card in Trash. The loading skeleton uses the same columns and gap.

## How to get to it (user POV)

- Web: Everything, any folder, Favorites, a search, or "Revisit" in the View menu (the deck shows the same tile, with no extra frame around it). Dark mode follows Settings → Appearance or the system. The View menu has no density choice.

## Driving it with the e2e MCP server and the API

- **Seeded types.** Everything already holds notes, quotes, palettes, links with and without images, an image, a video ("Find anything in Teak.mp4", 0:29), an audio ("Brand refresh voice memo.m4a", 0:17) and a PDF ("Teak search cheat sheet.pdf"). `observe` the grid: notes, quotes, palettes and audio have no footer text beyond their own content; the PDF's card lists "Teak search cheat sheet.pdf" and "PDF"; the audio's lists "0:17" and no file name. At 1440 px with the sidebar open the grid has five columns; at 390 px it has two.
- **Link covers.** With the API key from `scripts/api-key.ts`, `POST /v1/cards` with `{"content":"https://example.com/","tags":["verify-<run-id>"]}`. Search `#verify-<run-id>`: the card shows a globe and "example.com" on its cover and "Example Domain" (or the address, before its details arrive) in its footer.
- **Processing.** Take the screenshot right after the `POST`: the new link's card shows the processing bar along its bottom edge. It fills in within a minute.
- **Price.** A product page whose price Teak reads shows "$…" in the footer, before the marks. The dev deployment rarely gets a price; the footer's cases are in `Card.test.tsx`.
- **Done and favorite.** `POST /v1/cards/<id>/done` and `PATCH /v1/cards/<id>/favorite` `{"isFavorited":true}` on a marked link: its footer ends with a check ("Marked as read" or another verb) and a heart. In the web app, done is the open card's `D` key, not a grid key. Favorite a note or an image with `F`: its heart sits in the bottom right corner.
- **Pinned.** `PATCH /v1/cards/<id>/pin` `{"isPinned":true}`: the card moves to "Pinned", with no footer and no pin mark.
- **States.** `hover` a card for its actions; `tap` "Select" for the selection ring; focus a card and press ArrowRight for the focus ring; `hover` the video for its length pill. Proof for each: a screenshot with 18 px around the card, since the select button sits outside it.

## Gotchas

- Link images load lazily, and the grid adds cards in batches as you scroll: scroll down and wait before a screenshot or before looking for a card further down.
- The local stack (`bun run dev --local`) doesn't fetch link previews, so its links show their address as the title.
