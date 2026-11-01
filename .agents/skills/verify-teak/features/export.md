# Export

Settings → Import & export → Export makes one ZIP of every card outside Trash with its files, a bookmarks file and a spreadsheet. It runs in the background, once a week per account; the ready archive downloads for 7 days, and the panel always says when the next export can start.

## Sub-features

- `export-start` starts an export from the button "Start export". The button turns into "Cancel export" in the same place, and clicks in the first second after starting are ignored, so a double-click never cancels the export it just started.
- `export-progress` shows "Preparing your export…", "Snapshotting your cards" with a running count, then "Building your archive…".
- `export-ready` shows "Your export is ready" with its card count, size, files left out and "available until <date>", the button "Download archive", and below it "Next export available <date>" while the weekly limit holds ("One export per week, available for 7 days after it's ready." once it has passed).
- `export-quota` shows a disabled "Available in <countdown>" with "You've used this week's export." when there's no archive to download and the week isn't over.

## How to get to it (user POV)

- Settings → "Import & export" (`/settings/data`) → region "Export".
- Command palette: "Export".

## Driving it with e2e MCP

Preconditions:

- Signed in ([sign-in](./sign-in.md)) on an account that hasn't exported this week (the local stack's fresh accounts haven't). An export counts against the account's week, so use the local stack, not a shared account you need later.

Steps:

- **Double-click.** `navigate` to `/settings/data`. In region "Export", double-click button "Start export" (two `tap`s within a second). The toast reads "Export started. …", the button reads "Cancel export", and the status reads "Preparing your export…" or "Snapshotting your cards"; no "Export canceled." toast appears.
- **Cancel still works.** Wait two seconds and `tap` "Cancel export": the toast reads "Export canceled." Only do this when you don't need the archive; the week's export is used either way.
- **Ready.** Start an export on a fresh account and wait for "Your export is ready". The status line lists the card count and "available until <date>", and the line below reads "Next export available <date>", about seven days after the start. Screenshot it at 390 and 1440 px.

## Gotchas

- The weekly limit counts from the export's start, so "Next export available" can come before "available until".
- A canceled export still uses the week's export.
- The countdown on "Available in …" refreshes every 30 seconds, not every second.
