# Capture

A user saves anything into Teak from the composer at the top of Everything: a note, a link, a quote or a hex color. Teak picks the card type, and background processing fills in link titles, palettes, tags and summaries. The sidebar "New" menu also uploads files and records audio.

## Sub-features

- `capture-text` saves a note as a text card.
- `capture-link` turns a bare URL into a link card, whose title fills in after processing.
- `capture-quote` turns quoted text into a quote card, with the quotes stripped.
- `capture-palette` turns a hex color into a palette card after processing.
- `capture-focus` saves from the full-screen Focus editor.
- `capture-new-menu` opens the sidebar "New" menu: "Note or link", "Upload files", "Record audio".
- `capture-upload` uploads files as image, video, audio or document cards.
- `capture-audio` records audio into an audio card.

## How to get to it (user POV)

- The composer, textbox "Markdown content", at the top of `/` (Everything only).
- Press `N` anywhere to focus the composer. From another view it goes to `/?compose=1`; the library drops the `compose` param from the URL and focuses the composer.
- The sidebar button "New" (the "+" next to the logo).
- Press `U` to open the file picker.
- Command palette (Ctrl+K): "New note", "Upload files".

## Driving it with e2e MCP

Preconditions:

- Signed in on `/` ([sign-in](./sign-in.md)), and the grid has loaded (card buttons such as "Text: …" are listed, not the status "Loading cards").
- No card contains this run's marker.

Steps:

- **Text.** `tap` textbox "Markdown content", `type` "verify-<run-id> text note", then `tap` button "Save" (or `press` "Control+Enter"). The composer clears, the toast "Saved" appears, and a button "Text: verify-<run-id> text note" appears in the grid.
- **Persistence.** `navigate` to `/` (a reload), then search for the marker ([find](./find.md)). The same "Text: …" button is listed. `tap` it: a dialog named "Note" opens and the URL gains `?card=<id>`.
- **Link.** Save "https://example.com/?verify-<run-id>". The toast "Link saved" appears. A button starting "Link:" appears, named by the URL at first and by the page title once metadata arrives (often within a minute on the dev deployment).
- **Link inside a sentence.** Save `Read verify-<run-id> (https://example.com/?verify-<run-id>-s).` The card's URL has no `).` (its "Open link" opens `https://example.com/?verify-<run-id>-s`), and the card shows the words "Read verify-<run-id>." under its title, without the URL. Its dialog shows the same words below the link.
- **Characters.** Save `verify-<run-id> 3 < 5 & 7 > 2 <b>not bold</b>`. The card and its name read exactly that ("Text: verify-<run-id> 3 < 5 & 7 > 2 <b>not bold</b>"), never `&lt;`, `&gt;` or `&amp;`.
- **Quote.** Save `"verify-<run-id> quote"`, with the quotes. A button "Quote: verify-<run-id> quote" appears without quotes, and its dialog is named "Quote".
- **Palette.** Save `#2050D0 #F4A261 verify-<run-id>`. The card first appears as "Text: …" and becomes "Palette: …" once processing reclassifies it (allow 30 s, and observe again). Next to other words, one hex code stays text unless the note says "palette"; two codes, or a note that is only colors, become a palette.
- **Focus editor.** `type` into the composer, then `tap` button "Focus" (or `press` "Control+e"). A full-screen editor with its own textbox "Markdown content" opens. `press` "Control+Enter" to save; the card appears in the grid.
- **New menu.** `tap` button "New". The menu has items "Note or link", "Upload files" and "Record audio" (each name also contains its shortcut letter, so match with `exact: false`). "Note or link" focuses the composer.
- **Upload.** The picker's file input is created on demand, so the `e2e` `upload` tool finds no input. Drive the chooser over CDP instead (`.agents/cloud.md`, "File uploads from the e2e MCP server"). The toasts go "Uploading…" then "File uploaded" ("Uploaded <n> files" for several), and a button "Image: <name>" (or "Video:", "Audio:", "Document:") appears.
- **Record audio.** Needs Chromium launched with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream`. "Record audio" opens dialog "Recording audio". `tap` "Stop and Save"; the toast "Audio recording saved" appears and an "Audio:" card follows.

## Gotchas

- "Save" and "Focus" appear only once the composer has content. Other "Save" buttons may exist on the page, so scope to the composer.
- Typing before the composer is ready can be lost. If a typed value doesn't show in `observe`, wait and type again.
- Markdown formatting (a leading `# `, `- `, `> `, or `/` opening the "Formatting commands" menu) saves the note as text, never a link, quote or palette.
- Text containing a URL, like "see https://x.com", becomes a link card that keeps its text, and the card and its dialog show that text without the URL. Punctuation right after the URL (`.`, `,`, `)` and the like) isn't part of the link; brackets the URL opens itself, as in `…/wiki/Teak_(wood)`, are.
- The composer's toast says "Link saved" for a link and "Saved" for anything else, since processing may still make a note a quote or a palette.
- A note with no text (one emptied through the API, say) shows "Empty note" in the grid and gets no AI tags or summary.
- Processing shows only an aria-hidden progress bar, so there's no accessible "processing" text. Observe the card's name until it changes. The AI summary appears in the card dialog's "Summary" section.
- The free plan stops at 200 cards ("Free card limit reached"). Delete what each run creates so the shared account never fills up.
- Use a WebM (VP9) file to check video playback: Playwright's Chromium can't decode MP4.
- Drag-and-drop onto the composer is rejected with the toast "Paste text or Markdown into this note." That is intended.
