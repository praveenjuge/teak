# Import

Settings → Import & export → Import brings cards in from a file: browser bookmarks, any CSV with a header row, a text file of links, the named services (Pocket, Raindrop.io, Instapaper, Readwise Reader, Omnivore, Linkwarden, mymind) and a Teak archive. The file uploads, then imports in the background with progress, a one-line summary ("Last import: N created, M skipped"), the rows that failed and a downloadable report. Links already in the library, and repeats inside the file, are skipped by URL key.

## Sub-features

- `import-picker` lists "Browser bookmarks", "CSV file", "Text file of links", the services, then "Teak archive". OneTab is not offered; an import started as OneTab before still shows its name.
- `import-csv` reads url, title, tags, folder, note and created columns, and their aliases (Link, Name, Labels, Collection, Description, Date Added…), from a comma-separated CSV with a header row. The hint has a collapsed "Example".
- `import-csv-missing-url` stops a CSV whose header has no url column with "This CSV has no url column. Add a header row with a url (or link) column."
- `import-links` reads one link per line, optionally followed by " | Title" (OneTab's Export URLs too).
- `import-report` lists rows that couldn't be imported ("Row 4 has no url", unsafe links) under "Items that couldn't be imported", with "Copy error report" and "Download error report".
- `import-duplicates` skips links already saved and repeats in the file (the same link with `www`, `utm_*` or a fragment), counted as skipped.
- `import-archive-partial` imports a Teak archive with one file the import can't extract. Only that file's card fails, listed by its file name under "Items that couldn't be imported". The other file cards, including ones in the same batch of five, import with their files.

## How to get to it (user POV)

- Settings → "Import & export" (`/settings/data`) → region "Import".
- Command palette: "Import".

## Driving it with e2e MCP

Preconditions:

- Signed in ([sign-in](./sign-in.md)), with the backend that has the `csv` and `links` modes pushed: the running Core Worker and Convex must both know them, or the upload is refused or the import fails.
- No import is running (a second one is refused until the first finishes).
- Fixtures live in `packages/tests/src/web/import-fixtures/` (the e2e upload tool takes paths relative to `packages/tests`): `full.csv`, `aliases.csv`, `no-url.csv`, `variants.csv`, `unsafe-urls.csv`, `links.txt`. More awkward files are in `packages/convex/__tests__/import/fixtures/` (BOM and CRLF, quoted newlines, pipe tags); copy one into the fixtures folder to upload it.

Steps:

- **Picker.** `navigate` to `/settings/data`. Region "Import" is one dashed drop area with combobox "Import from", button "Choose file" and "or drop it here" (dropping a file there stages it for the chosen source, like "Choose file"; it is not saved as a card). `tap` combobox "Import from". The options read, in order: "Browser bookmarks", "CSV file", "Text file of links", "Pocket", "Raindrop.io", "Instapaper", "Readwise Reader", "Omnivore", "Linkwarden", "mymind", "Teak archive". There is no "OneTab".
- **CSV hint.** `tap` option "CSV file". The hint reads "A CSV with a header row. Teak reads url, title, tags, folder, note and created columns. Up to 20 MB." `tap` button "Example" (it starts collapsed): a block shows `url,title,tags,folder,note,created` and one sample row. Screenshot it in light and dark at 390 and 1440 px; the sample row scrolls inside its block, never the page.
- **Import a CSV.** Set `src/web/import-fixtures/aliases.csv` on the hidden file input, `input[type=file][accept=".csv"]`. e2e's `upload` can't reach that input and "Choose file" opens the system picker, so use Playwright's `setInputFiles` over CDP (see `.agents/cloud.md`, "File uploads"). A confirmation shows the file name and "CSV file · <size>"; `tap` "Start import". Progress runs through "Uploading", "Parsing import file" and "Importing cards", then the line reads "Last import: 1 created, 0 skipped — <when>". Go to Everything, search "Alias title", and open the card: title "Alias title", tags "alpha" and "beta", folder "Projects / Teak", note "Alias note", and "Added May 1, 2024, 10:00 AM" (the hour follows the browser's time zone).
- **Missing url column.** Import `no-url.csv`. The import stops: "Import stopped" and "This CSV has no url column. Add a header row with a url (or link) column."
- **Duplicates and the report.** Import `variants.csv` (three spellings of one link): "1 created, 2 skipped". Import it again: "0 created, 3 skipped". Import `unsafe-urls.csv`: "1 created" and "3 failed", and "Items that couldn't be imported" lists "Row 2: CSV link is unsafe…", "Row 3: …" and "Row 4 has no url". `tap` "Download error report"; the file lists the same rows.
- **Teak archive fixture.** Needs the local stack (`bun run dev --local --detach`) for the fresh account below. In the seeded account, upload four small PNGs named `<marker>-a.png` to `<marker>-d.png` ([capture](./capture.md)). In region "Export", `tap` "Start export", wait for "Your export is ready", and `tap` "Download archive". The newest cards come first in `cards.json`, so the four images are in the import's first batch of five. Break one of them so it fails while being extracted: in a copy of the ZIP, change the last letter of `<marker>-c.png`'s name in its local file header only (`.png` → `.pnx`). Take its path, `files/<card id>-<marker>-c.png`, from `cards.json`. `unzip -t broken.zip` then reports `mismatching "local" filename` for that entry and nothing else.

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

- **Teak archive with one bad file.** Create a fresh user on the emulator: `POST http://localhost:4100/user_management/users` with `Authorization: Bearer sk_test_default` and `{"email", "email_verified": true, "first_name", "last_name", "password"}` (the emulator has no sign-up screen). Sign in as that user ([sign-in](./sign-in.md)); its vault is seeded too. On `/settings/data`, choose "Teak archive" in combobox "Import from" (the hint reads "A ZIP from Export your data in Teak. Up to 5.0 GB.") and set `broken.zip` on `input[type=file][accept=".zip"]`. The confirmation shows "broken.zip" and "Teak archive · <size>"; `tap` "Start import". The line then reads "Last import: 36 created, 1 skipped, 1 failed — just now". The 36 and 1 come from a 38-card export of the seeded vault; there is always exactly 1 failed. "Items that couldn't be imported" lists one item, named "<marker>-c.png", with the reason "This file couldn't be imported from the archive. Upload it on its own." `tap` "Download error report": `teak-import-report.txt` reads "Created: 36", "Skipped: 1", "Failed: 1" and "2. <marker>-c.png: This file couldn't be imported from the archive. Upload it on its own." Go to Everything and search the marker: buttons "Image: <marker>-a.png", "Image: <marker>-b.png" and "Image: <marker>-d.png" show their images, and there is no "-c" card.
- **Text file of links.** Choose "Text file of links" (the file chooser takes `.txt`) and import `links.txt`: 3 created, the third titled "Third | with a pipe".
- **Clean up.** Move the imported cards to Trash and delete the folders the import made ("Work / Design", "Reading", "Projects / Teak"). After the archive import, delete the fresh account (Settings → Security → "Delete your account", [settings](./settings.md)), then in the seeded account move the marked images to Trash and "Delete Forever" ([card-actions](./card-actions.md)).

## Gotchas

- Imports parse in the Core Worker, so a new import mode needs the Core Worker and Convex deployed (Core Worker first). Until then, choosing a new source fails at "Start import" (Convex refuses the mode) or right after parsing (the Worker doesn't know it).
- Only comma-separated CSVs are read. A semicolon-separated file (European spreadsheet exports) has one column and stops with the missing url column message.
- Rows are numbered as a spreadsheet shows them: the header is row 1, blank lines count, and a quoted cell over several lines is one row.
- Skipped duplicates are counted, not listed in the report; the report lists failed rows only.
- The free plan stops at 200 cards: an import past it ends with the card limit message. Use an account with room.
- The free plan's card rate limit slows big imports after the first 30 cards ("Waiting for card rate limit", about one card every 2 s); give a large file minutes, not seconds.
- Imports never move an existing card to the top or change it; a link already saved is only skipped.
- Deleting a file from a Teak archive doesn't test `import-archive-partial`. The import finds the missing entry before it extracts anything, so the item fails as "Item <n>" with "Missing ZIP entry: files/<card id>-<name>", and this happened before the fix too. Use the local header change above, which only fails during extraction.
- Every file that fails during extraction shows the same English sentence, whatever the cause; like other import errors, it isn't translated. The cause is in the Core Worker's log as `[workflows/import] file extraction failed` with its `failureClass` (here `files_worker_error:INVALID_INPUT:400:wf-<id>`); locally that's `.agents/.state/stack.log`.
- Export runs once a week per account ("You've used this week's export."). Keep the ZIP from the first export and make new copies of it.
