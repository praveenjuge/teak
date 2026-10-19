# Teak verification map

This directory is the maintained source for verifying Teak's user-facing behavior. Read this index before driving the app, then use the matching feature file as the recipe. Launch, doctor, evidence and cleanup are in [`../SKILL.md`](../SKILL.md).

## Baseline preconditions

- The dev stack is running (`bun run dev --detach`) and `bun .agents/skills/verify-teak/scripts/doctor.ts` exits 0.
- The account is the one in `.agents/.state/stack.json`. Its vault is seeded (`packages/convex/devSeed.ts`, `packages/convex/card/defaultCards.ts`): text, link, quote, palette, image and video cards; the folder "Start here"; the smart folder "Moodboard" (`type:image type:palette`); and several favorites, including the "Welcome to Teak…" card. Never assume the grid is empty or that a new card comes first.
- The run has a marker, `verify-<run-id>`, and an evidence folder, `.agents/.state/verify/<run-id>/`.
- Never drive a stack this run didn't health-check, and never drive the E2E suite's stack while `bun run --cwd packages/tests e2e` is running.

## Driving conventions

- Web steps go through the `e2e` MCP server (`open_session` with `config: "packages/tests/e2e.config.ts"`). Name nodes by role and accessible name exactly as written here. `observe` again after every navigation, since node ids expire.
- Single-key shortcuts (`N`, `U`, `/`, `f`, `e`, `x`, `g` sequences) fire only when focus is outside a text field. Press `Escape` or tap empty space first.
- Hover-only card buttons ("Favorite", "More actions", "Select", "Open link") are hidden until the card is hovered. `hover` the card first, or use `right_click` on the card, which opens the same menu.
- Markers must not be color, style or time words ("orange", "minimal", "today"), or words Teak treats as commands ("fav", "trash", "archive"): search turns those into filters or navigates.
- API, CLI and MCP steps run from the repository root with the key from `scripts/api-key.ts` (see [api-cli-mcp](./api-cli-mcp.md)).
- Leave the seeded vault as you found it: undo every favorite, tag, archive or folder change you make to a seeded card.

## Proof and skip reporting

- Capture the action and the resulting state, not only the final screen: screenshot before and after, or the `observe` lines that changed.
- Prove persistence from a second view: reload, another route, a search, or a read through the API.
- Record the feature id and entry point with every artifact in `notes.md`.
- Report an unreachable path with the attempted step and the unmet precondition. Don't report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior, then exactly four H2 sections in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with <harness>`, `Gotchas`. `scripts/verify-feature-map.test.ts` checks the shape. Keep implementation details out; name only user paths, stable handles, required state, commands and observable proof.

## Features

- [Sign in and sign out](./sign-in.md) covers the auth redirect, the hosted WorkOS sign-in page, and signing out from Settings and the command palette.
- [Capture](./capture.md) covers the composer (text, link, quote, palette), the Focus editor, the "New" menu, uploads and audio recording.
- [Find](./find.md) covers search, qualifiers and chips, the View menu, sidebar views, tags and folders, the command palette, and empty states.
- [Card actions](./card-actions.md) covers the card dialog (notes, tags, folders), favorites, archive, Trash, restore, delete forever, and bulk selection.
- [Settings](./settings.md) covers the Settings page, theme, devices and API keys in the Security dialog.
- [API, CLI and MCP](./api-cli-mcp.md) covers the REST API, the CLI from this checkout and the MCP server, with an API key.
- [Link transcripts and video facts](./link-transcripts.md) covers Vimeo captions and podcast episode transcripts found by a spoken phrase, and YouTube's Channel, Length and Uploaded facts.
- [Card links](./card-links.md) covers `[[` links between notes, pills with live titles, "Missing card", the "Linked from" section, and `links`/`backlinks` in the API, MCP, SDK and CLI.
- [Card processing](./card-processing.md) covers the background work after a save (stages, AI tags and summary), read through the local Files Worker's Workflow runs, logs, stored files and crons in Cloudflare's Local Explorer.
- [Save by email](./save-by-email.md) covers the Settings switch, mail from the sign-in email becoming link and note cards tagged email, attachments as their own cards, and what's refused or dropped.

## Not mapped yet

Add a file here when a change touches one of these: import and export (Settings), the browser extension (`.agents/cloud.md` has the load steps), Raycast, the docs site, the Apple and Android apps (no macOS or Android SDK in cloud sessions), and billing ("Upgrade to Pro" with Polar's sandbox).
