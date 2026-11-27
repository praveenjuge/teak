# Export

Settings → Import & export → Export makes one ZIP of every card outside Trash with its files, a bookmarks file and a spreadsheet. It runs in the background once a week per account; the archive downloads for 7 days.

## Sub-features

- `export-start` starts an export from "Start export", which becomes "Cancel export" in place; clicks in the first second are ignored, so a double-click never cancels the new export.
- `export-progress` shows "Preparing your export…", "Snapshotting your cards" with a running count, then "Building your archive…".
- `export-ready` shows "Your export is ready" with its card count, size, files left out and "available until <date>", the button "Download archive", and below it "Next export available <date>" while the weekly limit holds ("One export per week, available for 7 days after it's ready." once it has passed).
- `export-quota` shows a disabled "Available in <countdown>" with "You've used this week's export." when there's no archive to download and the week isn't over.

## How to get to it (user POV)

- Settings → "Import & export" (`/settings/data`) → region "Export".
- Command palette: "Export".

## Driving it with e2e MCP

Preconditions:

- Signed in ([sign-in](./sign-in.md)) on an account that hasn't exported this week. Use a fresh local-stack account, not a shared one: an export uses the account's week.

Steps:

- **Double-click.** On `/settings/data`, in region "Export", double-click "Start export" (two `tap`s within a second). Toast "Export started. …", button "Cancel export", status "Preparing your export…" or "Snapshotting your cards"; no "Export canceled." toast.
- **Cancel still works.** Wait two seconds and `tap` "Cancel export": toast "Export canceled."
- **Ready.** On a fresh account, wait for "Your export is ready" with "available until <date>" and, below, "Next export available <date>" about seven days after the start. Screenshot it at 390 and 1440 px.

## Gotchas

- The weekly limit counts from the export's start, so "Next export available" can come before "available until".
- A canceled export still uses the week's export.
- The "Available in …" countdown refreshes every 30 seconds, not every second.
