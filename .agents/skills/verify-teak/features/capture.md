# Capture

The composer at the top of Everything saves a note, link, quote or hex color; Teak picks the card type, and background processing fills in link titles, palettes, tags and summaries. The sidebar "New" menu also uploads files and records audio.

## Sub-features

- `capture-text` saves a note as a text card.
- `capture-link` turns a bare URL into a link card; its title fills in later.
- `capture-quote` turns quoted text into a quote card, with the quotes stripped.
- `capture-palette` turns a hex color into a palette card after processing.
- `capture-resave` moves a link already in Teak to the top (and back from Archive) instead of saving a second card; one in Trash saves nothing and offers "Restore".
- `capture-draft` keeps the composer's unsaved note per account across reloads and pages, and when the empty library's composer gives way to the grid's. Esc leaves the composer with it kept; N from a page without a composer opens Everything with it, focused.
- `capture-paste-links` saves a pasted list of links, one per line, as a link card each, in the background.
- `capture-focus` saves from the full-screen Focus editor.
- `capture-new-menu` opens the sidebar "New" menu (N, U, R); below 768 px (sidebar a closed drawer) from the header's "+" button "New". Touch screens show no key letters.
- `capture-narrow` keeps `U`, `R` and the palette's "Upload files" working at every width; a recording started from the drawer's menu keeps going once the drawer closes.
- `capture-composer-focus` rings the focused composer with the `--ring` colour (a 3 px soft ring), not the brand red.
- `capture-composer-search` shows the composer only on Everything with no search or filter; `N` during a search goes to `/` and focuses it.
- `capture-upload` uploads files as image, video, audio or document cards.
- `capture-audio` records an audio card; "Discard" or Esc throws it away. A recording whose save fails stays in the dialog to retry or download ([errors](./errors.md)).

## How to get to it (user POV)

- Textbox "Markdown content" at the top of `/` (Everything only).
- `N` anywhere focuses the composer; from another view it goes to `/?compose=1`, and the library drops the `compose` param. `U` opens the file picker, `R` records audio.
- The sidebar button "New" under the logo (just its "+" in the collapsed rail).
- On a phone, the "+" button "New" in the page header (after "Search" and "View"); hidden on Trash, where "Empty Trash" sits.
- Command palette (Ctrl+K): "New note", "Upload files".

## Driving it with e2e MCP

Preconditions:

- Signed in on `/` ([sign-in](./sign-in.md)), and the grid has loaded (card buttons such as "Text: …" are listed, not the status "Loading cards").
- No card contains this run's marker.

Steps:

- **Text.** `tap` textbox "Markdown content", `type` "verify-<run-id> text note", then `tap` button "Save" (or `press` "Control+Enter"): the composer clears, toast "Saved", and a button "Text: verify-<run-id> text note" appears.
- **Persistence.** `navigate` to `/`, search for the marker ([find](./find.md)): the same "Text: …" button is listed. `tap` it: a dialog named "Note" opens and the URL gains `?card=<id>`.
- **Link.** Save "https://example.com/?verify-<run-id>": the toast "Link saved", then a button starting "Link:", named by the URL, then by the page title once metadata arrives (often within a minute).
- **Save a link again.** Save it again, or a variant ("http://www.example.com/?verify-<run-id>&utm_source=x"): "Already in Teak · Moved to the top" with "Open" (opens the card's dialog); still one "Link:" button, now first. Archive it, save again: "Already in Teak · Moved back from Archive". Trash it, save again: no card, the link stays in the composer, toast "This link is in Trash" with a button "Restore". `tap` "Restore": "Restored from Trash · Moved to the top", the composer clears and the card is first in Everything, gone from Trash.
- **Paste a list of links.** Paste (a `paste` `ClipboardEvent` with `text/plain`, as `pasteMarkdown` in `packages/tests/src/web/editor-library.ts` does) 12 lines `https://example.com/verify-<run-id>/1` … `/12`. The button reads "Save 12 links" (101 or more lines: "Save first 100 links"). Save: the composer clears, a loading toast counts "Saving links · 8 of 12", then "Saved 12 links"; 12 "Link:" buttons appear. Three lines, one already saved: "Saved 2 links · 1 already in Teak, moved to the top". `/a`, `/b`, `/a` (or a variant like `http://www.…/a/`): "Save 2 links" and progress "0 of 2". Pasting while a long list is saving: "Still saving your last links. Try again in a moment.", draft kept. Seed `paste-links` on a free account (195 cards, ten links under example.com/paste-links/), paste those ten plus five or more new links: the known ones move, five new ones are saved, toast "Saved … of … links · You've reached 200 cards" with "Upgrade".
- **Link inside a sentence.** Save `Read verify-<run-id> (https://example.com/?verify-<run-id>-s).` Its "Open link" opens `https://example.com/?verify-<run-id>-s` (no `).`), and the card and its dialog show "Read verify-<run-id>." without the URL.
- **Characters.** Save `verify-<run-id> 3 < 5 & 7 > 2 <b>not bold</b>`: the card and its name ("Text: …") read exactly that, never `&lt;`, `&gt;` or `&amp;`.
- **Quote.** Save `"verify-<run-id> quote"`, with the quotes: a button "Quote: verify-<run-id> quote" without quotes, whose dialog is named "Quote".
- **Palette.** Save `#2050D0 #F4A261 verify-<run-id>`. It appears as "Text: …", then "Palette: …" once processing reclassifies it (allow 30 s, observe again). Next to other words, one hex code stays text unless the note says "palette"; two codes, or a note of only colors, become a palette.
- **Draft.** `type` "verify-<run-id> draft", `navigate` to `/`: the text is still there. Save, reload: empty. Drafts live in localStorage `teak:composer-draft:<user id>`; if the browser can't store one, closing the tab asks first.
- **Esc.** With text in the composer and no menu open, `press` "Escape": focus leaves and the text stays; `press` "x" or "/": nothing is typed and the shortcut runs. With the slash or `[[` menu open, Esc closes the menu first.
- **Focus editor.** `type` into the composer, `tap` button "Focus" (or `press` "Control+e"): a full-screen editor with its own textbox "Markdown content". "Control+Enter" saves the card to the grid. Its word count (after a second) counts `verify-capx-9` or `long-term` as one word. In Focus, `type` "/" on a new line, `press` "Escape": only the slash menu closes (likewise the link editor from Control+k). Another "Escape" closes Focus; `document.activeElement` is the card dialog, not its "Focus" button (no "Focus" tooltip).
- **New menu.** `tap` button "New": items "Note or link", "Upload files" and "Record audio", showing N, U and R (names contain the letter, so match with `exact: false`). "Note or link" focuses the composer. `press` "r" with nothing focused: dialog "Recording audio". The `?` sheet lists "Record audio" with R under "Anywhere".
- **Phones and narrow windows.** At 740 × 900 (mouse), with nothing focused, `press` "u": the file chooser opens (Playwright `filechooser`); `press` "r": dialog "Recording audio"; "Discard". Ctrl+K, `type` and `tap` option "Upload files" (card results can rank first, so don't press Enter): the file chooser opens. Emulate `devices['iPhone 13']`: the header has "Search", "View" and "New"; `tap` "New": the same three items, no key letters; "Record audio" opens the dialog. `navigate` to `/?q=design`: no textbox "Markdown content", and the first card sits right under "N cards match".
- **Upload.** The file input is created on demand, so `e2e` `upload` finds none; drive the chooser over CDP (`apps/docs/content/docs/(open-source)/development.mdx`, "Cloud sessions in detail"). Toasts: "Uploading…" then "File uploaded" ("Uploaded <n> files" for several), and a button "Image: <name>" (or "Video:", "Audio:", "Document:") appears. The input's `accept` lists only what Teak saves (no `*/*`). Upload three good files, an empty `x-empty.txt` and a `.exe`: "Uploaded 3 of 5 files. Empty file, nothing to save: x-empty.txt. Teak can't save this type of file: <name>.exe.", never server text like "fileSize must be a positive number"; over three failed files of one kind read "a, b, c, and 2 more".
- **Paste an image.** Paste an image into textbox "Markdown content" (headless: a `paste` `ClipboardEvent` whose `clipboardData` holds a `File`, on the focused editor): "Uploading…", "File uploaded", an "Image: <name>" card, and the composer stays empty. Pasting outside any text field uploads too.
- **Record audio.** Needs Chromium launched with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream`. "Record audio" opens dialog "Recording audio". `tap` "Stop and Save": the toast "Audio recording saved", then an "Audio:" card. Record again, `tap` "Discard" (or `press` "Escape"): the dialog closes, no toast, no card. A click outside it while recording leaves it open.

## Gotchas

- "Save" and "Focus" appear only once the composer has content. Scope "Save" to the composer: there are others.
- Typing before the composer is ready can be lost: if `observe` doesn't show it, wait and type again.
- Markdown formatting (a leading `# `, `- `, `> `, or `/` opening the "Formatting commands" menu) always saves as text.
- Text containing a URL ("see https://x.com") becomes a link card that keeps its text, shown without the URL. Punctuation right after the URL (`.`, `,`, `)`…) isn't part of the link; brackets the URL opens itself (`…/wiki/Teak_(wood)`) are.
- Non-links toast "Saved", not "Link saved", since processing may still make a note a quote or a palette.
- A draft splits into links only when every non-empty line is a single http(s) URL (plain, a link showing its own address, or `<…>`), in paragraphs or list items, at least two of them. A URL with words after it, a code block, a quote, a checklist or one link saves as one card.
- A paste job saves 10 links at once, then about 30 a minute (the card creation limit), so 100 links take three to four minutes. The job runs on the server, one per account: closing the tab drops the toast, not the cards.
- A note with no text (emptied through the API) shows "Empty note" in the grid and gets no AI tags or summary.
- Processing shows only an aria-hidden progress bar: observe the card's name until it changes. The AI summary is in the dialog's "Summary" section.
- The free plan stops at 200 cards ("Free card limit reached"); delete what each run creates on the shared account. Every way of saving (composer, pasted list, files, recording, Save PDF) shows that toast with "Upgrade", which opens `/settings/plan` without reloading; too many cards at once reads "Too many cards created. Please wait a moment." everywhere.
- Picked, dropped and pasted files share one upload queue, sending `card_create_submitted` {via: `file_upload`} once per file.
- Check video playback with WebM (VP9): Playwright's Chromium can't decode MP4.
- Dropping onto the composer is rejected by design ("Paste text or Markdown into this note."), and so is pasting files into a card dialog's note ("Paste plain text or Markdown.").
- An unanswered upload attempt is abandoned after a minute (plus time for the file's size) and retried, twice at most, then fails with "The upload stopped responding. Check your connection and try again." To check, hold the first `PUT` to the Core Worker with Playwright's `page.route`, letting later ones through: "File uploaded" arrives after about 62 s.
- Once a file in a batch hits the free card limit or the rate limit, the rest isn't uploaded.
