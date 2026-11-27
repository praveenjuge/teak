# Import

Settings → Import & export → Import brings in browser bookmarks, any CSV with a header row, a text file of links, the named services and a Teak archive. The file uploads and imports in the background with progress, a one-line summary, the failed rows and a downloadable report.

## Sub-features

- `import-picker` lists the sources (order under **Picker**). OneTab isn't offered; an earlier OneTab import still shows its name.
- `import-csv` reads url, title, tags, folder, note and created columns and aliases (Link, Name, Labels, Collection, Description, Date Added…). The header line decides the separator: commas, or semicolons or tabs when it has none. The hint has a collapsed "Example".
- `import-csv-missing-url` stops a CSV with no url column (message under **Missing url column**).
- `import-csv-malformed` fails only a CSV's broken row, and later rows import: an unclosed quote ends at its own line ("This row has a quote that is never closed. Close it, or remove it."), text after a closing quote ("This row has text after a closing quote. …"), a link with a space or no real host ("Row N: CSV link isn't a valid web address").
- `import-links` reads one link per line, optionally with " | Title" (OneTab's Export URLs too). Blank lines are skipped; other non-links fail ("Line N isn't a link").
- `import-report` lists failed rows under "Items that couldn't be imported": label (title or link, else "Row N", or the text line) over reason, never the row number twice; plus "Copy error report" and "Download error report".
- `import-last` sums up the last import ("Last import: N created, M skipped — <when>") with the file's name and source below ("links.csv · CSV file"). Touch screens hide "or drop it here".
- `import-duplicates` skips, by URL key, links already saved and repeats in the file (the same link with `www`, `utm_*` or a fragment), counting them as skipped.
- `import-archive-partial` imports a Teak archive with one unextractable file: only that card fails, listed by file name; the rest, even in its batch of five, import with their files.

## How to get to it (user POV)

- Settings → "Import & export" (`/settings/data`) → region "Import".
- Command palette: "Import".

## Driving it with e2e MCP

Preconditions:

- Signed in ([sign-in](./sign-in.md)); the running Core Worker and Convex both know the `csv` and `links` modes.
- No import is running (a second is refused).
- Fixtures are in `packages/tests/src/web/import-fixtures/` (upload paths are relative to `packages/tests`): `full.csv`, `aliases.csv`, `no-url.csv`, `variants.csv`, `unsafe-urls.csv`, `semicolon.csv`, `unclosed-quote.csv`, `links.txt`. Awkward files (BOM and CRLF, quoted newlines, pipe tags) are in `apps/core-worker/src/archives/sources/fixtures/`; copy one into the fixtures folder to upload it.

Steps:

- **Picker.** `navigate` to `/settings/data`. Region "Import" has rows "Import from" (combobox) and "File" (hint, "or drop it here", button "Choose file"); a file dropped anywhere on it is staged like "Choose file", not saved as a card. `tap` combobox "Import from": in order, "Browser bookmarks", "CSV file", "Text file of links", "Pocket", "Raindrop.io", "Instapaper", "Readwise Reader", "Omnivore", "Linkwarden", "mymind", "Teak archive". No "OneTab".
- **CSV hint.** `tap` option "CSV file". The hint reads "A CSV with a header row. Teak reads url, title, tags, folder, note and created columns. Up to 20 MB." `tap` button "Example": a block shows `url,title,tags,folder,note,created` and one sample row. Screenshot it light and dark at 390 and 1440 px; the row scrolls inside its block, never the page.
- **Import a CSV.** Set `src/web/import-fixtures/aliases.csv` on the hidden `input[type=file][accept=".csv"]` with Playwright's `setInputFiles` over CDP (`apps/docs/content/docs/(open-source)/development.mdx`, "Cloud sessions in detail"): e2e's `upload` can't reach it and "Choose file" opens the system picker. The confirmation shows the file name and "CSV file · <size>"; `tap` "Start import". Progress: "Uploading", "Parsing import file", "Importing cards", then "Last import: 1 created, 0 skipped — <when>". Search "Alias title" and open the card: title "Alias title", tags "alpha" and "beta", folder "Projects / Teak", note "Alias note", and "Added May 1, 2024, 10:00 AM" (the hour follows the browser's time zone).
- **Missing url column.** Import `no-url.csv`: "Import stopped" and "This CSV has no url column. Add a header row with a url (or link) column."
- **Semicolons.** Import `semicolon.csv`: "Last import: 2 created, 0 skipped" over "semicolon.csv · CSV file"; the first card is "Semicolon; title" with tags "a" and "b".
- **A broken row.** Import `unclosed-quote.csv`: "2 created, 0 skipped, 2 failed". The list shows "Row 2" with "This row has a quote that is never closed. Close it, or remove it." and "Space in link" with "Row 5: CSV link isn't a valid web address". No card's link holds several lines.
- **Duplicates and the report.** Import `variants.csv` (three spellings of one link): "1 created, 2 skipped". Import it again: "0 created, 3 skipped". Import `unsafe-urls.csv`: "1 created", "3 failed", and the list shows "Script" with "Row 2: CSV link is unsafe…", "Data" with "Row 3: …" and "No link" with "Row 4 has no url" (not "Row 4" over it). "Download error report" lists the same rows.
- **Teak archive fixture.** Needs the local stack (`bun run dev --local --detach`) for the fresh account. In the seeded account, upload four small PNGs, `<marker>-a.png` to `<marker>-d.png` ([capture](./capture.md)). In region "Export", `tap` "Start export", wait for "Your export is ready", `tap` "Download archive". Newest cards come first in `cards.json`, so the images land in the first batch of five. To make one fail during extraction, change the last letter of `<marker>-c.png`'s name in a ZIP copy's local file header only (`.png` → `.pnx`), taking its path, `files/<card id>-<marker>-c.png`, from `cards.json`. `unzip -t broken.zip` then reports `mismatching "local" filename` for that entry only.

  ```bash
  python3 -I - teak-export-<date>.zip broken.zip "files/<card id>-<marker>-c.png" <<'PY'
  import sys
  src, dst, name = sys.argv[1], sys.argv[2], sys.argv[3].encode()
  d = bytearray(open(src, "rb").read())
  i = d.find(name)
  while d[i - 30:i - 26] != b"PK\x03\x04":
      assert i >= 0, "no local header for that name"
      i = d.find(name, i + 1)
  d[i + len(name) - 1] = ord("x")  # .png -> .pnx in the local header only
  open(dst, "wb").write(d)
  PY
  ```

- **Teak archive with one bad file.** Create a fresh emulator user: `POST <emulatorOrigin>/user_management/users` (`stack.urls.emulatorOrigin` in `bun run dev --status --json`) with `Authorization: Bearer sk_test_default` and `{"email", "email_verified": true, "first_name", "last_name", "password"}` (no sign-up screen). Sign in as it ([sign-in](./sign-in.md)); its vault is seeded too. On `/settings/data`, choose "Teak archive" in combobox "Import from" (hint: "A ZIP from Export your data in Teak. Up to 5.0 GB.") and set `broken.zip` on `input[type=file][accept=".zip"]`. Confirmation: "broken.zip" and "Teak archive · <size>"; `tap` "Start import". The line reads "Last import: 36 created, 1 skipped, 1 failed — just now" (36 and 1 from a 38-card seeded export; always exactly 1 failed). "Items that couldn't be imported" lists only "<marker>-c.png", with "This file couldn't be imported from the archive. Upload it on its own." `tap` "Download error report": `teak-import-report.txt` reads "Created: 36", "Skipped: 1", "Failed: 1" and "2. <marker>-c.png: This file couldn't be imported from the archive. Upload it on its own." Search the marker in Everything: buttons "Image: <marker>-a.png", "Image: <marker>-b.png" and "Image: <marker>-d.png" show their images; no "-c" card.
- **Text file of links.** Choose "Text file of links" (`.txt`) and import `links.txt`: "3 created, 0 skipped, 1 failed", the third titled "Third | with a pipe". The list shows "not a link line" with "Line 6 isn't a link".
- **Phone.** At 390 px: "Choose file", no "or drop it here".
- **Clean up.** Trash the imported cards and delete the import's folders ("Work / Design", "Reading", "Projects / Teak"). After the archive import, delete the fresh account (Settings → Security → "Delete your account", [settings](./settings.md)), then in the seeded account Trash the marked images and "Delete Forever" ([card-actions](./card-actions.md)).

## Gotchas

- A new import mode needs the Core Worker, which parses, and Convex deployed (Core Worker first); until then it fails at "Start import" (Convex refuses the mode) or right after parsing (the Worker doesn't know it).
- The parsers are in `apps/core-worker/src/archives/sources/` (Convex keeps item validation and the job); `bun test apps/core-worker/src/archives` runs them with the export round trips.
- A header with any comma reads as comma-separated, even if rows use semicolons.
- Imports from before the row-label fix keep stored reasons ("Row 4 has no url" under "Row 4"); the panel hides the repeated label, the downloaded report shows both.
- Rows are numbered as in a spreadsheet: header is row 1, blank lines count, a multi-line quoted cell is one row.
- The report lists failed rows only; skipped duplicates are just counted.
- The free plan stops at 200 cards (the card limit message ends the import): use an account with room.
- The free plan's rate limit slows imports after 30 cards ("Waiting for card rate limit", about one card every 2 s): give a large file minutes.
- Imports never move or change an existing card; a saved link is only skipped.
- Deleting a file from a Teak archive doesn't test `import-archive-partial`: the import catches the missing entry before extracting ("Item <n>" with "Missing ZIP entry: files/<card id>-<name>"), as before the fix. Use the local header change, which fails only during extraction.
- Every extraction failure shows the same untranslated sentence; the cause is in the Core Worker's log as `[workflows/import] file extraction failed` with its `failureClass` (here `files_worker_error:INVALID_INPUT:400:wf-<id>`), locally in `.agents/.state/stack.log`.
- Export runs once a week per account ("You've used this week's export."): keep the first ZIP and copy it.
