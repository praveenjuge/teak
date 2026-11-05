# Card tiles in the grid

Every card in the web grid that isn't an image or a video is a white tile of one shape (6:5, a little wider than tall) with a gray border: notes, quotes, links, palettes, audio and documents. Images and videos keep their own shape, held between portrait 3:4 and widescreen 16:9, and have no frame. Only links have a line under the tile: the site's favicon, the link's name, and the done mark once marked. Price, video length, audio format and length, and a document's file type all sit in one dark pill at the tile's bottom left.

## Sub-features

- `tile-note` shows a note's first line as a heading and fades the rest out at the tile's bottom; a short note with no heading (80 characters or fewer) is set large. A note clipped from a page names its site at the bottom of the tile. An empty note reads "Empty note".
- `tile-quote` sets a quote in serif type after a red opening quote mark, smaller as it grows (short, medium, long), so each fills the same tile. A quote with a source names its site at the bottom.
- `tile-link` fills a link's tile with its preview image or screenshot. A screenshot or banner much wider than the tile keeps its top left. A link without an image gets a cover: its favicon at the top left, its title in serif (up to three lines; the address when it has no title yet) and its site name. The line under the tile shows the favicon (a globe when the site has none), the name and the done mark ("Marked as read", "Marked as bought"…). A link's notes and description aren't on the tile; they're in the card.
- `tile-badge` puts the price ("$79.00"), a video's length (play icon plus "0:42"), an audio's format and length ("M4A · 0:17") and a document's file type ("PDF") in the same pill at the bottom left. A video's pill hides while the video plays on hover.
- `tile-media` shows images and videos without a border, cropped to their own shape between 3:4 and 16:9, with a faint edge so a white image doesn't melt into the page.
- `tile-palette` fills the tile with the palette's colors; a swatch widens and shows its hex code on hover.
- `tile-audio` shows the recording's name at the top, then the play button and the waveform.
- `tile-document` shows the first page of a document with a thumbnail inside the tile; one without a thumbnail shows a file icon and its name.
- `tile-states` keeps the existing marks and states on the new tiles: favorite and pin marks at the top right, the hover actions ("Open link", "Favorite", "More actions") and "Select", the selection ring, the keyboard focus ring, and the processing bar while a card is still being processed. The loading skeleton uses the same tile shape.

## How to get to it (user POV)

- Web: Everything, any folder, Favorites, a search, or "Revisit" in the View menu (the deck shows the same tile). Dark mode follows Settings → Appearance or the system. "Compact" density in the View menu shrinks the columns; the tiles keep their shape.

## Driving it with the e2e MCP server and the API

- **Seeded types.** Everything already holds notes, quotes, palettes, links with and without images, an image, a video ("Find anything in Teak.mp4", 0:29), an audio ("Brand refresh voice memo.m4a", 0:17) and a PDF ("Teak search cheat sheet.pdf"). `observe` the grid: each non-media tile is as wide as its column and 5/6 as tall; image and video cards are not.
- **Link covers.** With the API key from `scripts/api-key.ts`, `POST /v1/cards` with `{"content":"https://example.com/","tags":["verify-<run-id>"]}` and with a page that blocks fetching (some store listings do). Search `#verify-<run-id>`: example.com shows the cover "Example Domain" with "example.com" under it and a globe favicon; the blocked page shows its address as the cover title.
- **Processing.** Take the screenshot right after the `POST`: the new link's tile is blank or a cover, with the processing bar along the card's bottom edge. It fills in within a minute.
- **Badges.** A product page whose price Teak reads gets "$…" at the bottom left of its image. Search `type:video` and `type:audio` for "0:29" with a play icon and "M4A · 0:17"; `type:document` for "PDF".
- **Done, favorite, pinned.** `POST /v1/cards/<id>/done`, `PATCH /v1/cards/<id>/favorite` `{"isFavorited":true}` and `PATCH /v1/cards/<id>/pin` `{"isPinned":true}` on a marked link: its tile shows the pin and heart at the top right, the line under it ends with "Marked as read" (or another verb), and the card moves to "Pinned".
- **States.** `hover` a tile for its actions; `tap` "Select" for the selection ring; focus a card and press ArrowRight for the focus ring. Proof for each: a screenshot with 14 px around the card, since the select button sits outside the tile.

## Gotchas

- Link images load lazily: scroll the grid and wait before a screenshot, or tiles look blank.
- The dev deployment rarely gets a price from a store page (one of five tried gave one); the badge's own cases are in `Card.test.tsx`.
- Next.js's dev badge sits over the bottom right of the page; hide `nextjs-portal` before a screenshot.
- Phones show one column (the grid's minimum column is 200 px), so every tile is full width there.
