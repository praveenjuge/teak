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

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior, then exactly four H2 sections in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with <harness>`, `Gotchas`. `scripts/repo/verify-feature-map.test.ts` checks the shape. Keep implementation details out; name only user paths, stable handles, required state, commands and observable proof.

## Features

- [Sign in and sign out](./sign-in.md) covers the auth redirect, the hosted WorkOS sign-in page, and signing out from Settings and the command palette.
- [Capture](./capture.md) covers the composer (text, link, quote, palette), the Focus editor, the "New" menu, uploads and audio recording.
- [Find](./find.md) covers search, qualifiers and chips, the View menu, sidebar views, tags and folders, the command palette, and empty states.
- [Card actions](./card-actions.md) covers the card dialog (notes, tags, folders), favorites, archive, Trash, restore, delete forever, and bulk selection.
- [Palette colors](./palette-colors.md) covers adding and removing a palette's colors in the card dialog (picker, hex field, Remove with Undo, the 12-color and one-color limits), color search after a change, and `addColors`/`removeColors` in the API, MCP, SDK and CLI.
- [Settings](./settings.md) covers the Settings pages (Account, Plan, Appearance, Integrations, Security, Import & export), their nav and `G S` shortcut, theme, devices, API keys, the plan and usage, and delete account.
- [API, CLI and MCP](./api-cli-mcp.md) covers the REST API, the CLI from this checkout and the MCP server, with an API key.
- [Teak in Claude](./claude-connector.md) covers the card view MCP clients render for Teak's card tools (grid, detail, saved, in light, dark and other languages, under its own CSP), the Claude plugin installed from this repository's marketplace with its commands run against the dev server, and the reviewer-account seed.
- [Link transcripts and video facts](./link-transcripts.md) covers Vimeo captions and podcast episode transcripts found by a spoken phrase, and YouTube's Channel, Length and Uploaded facts.
- [Card links](./card-links.md) covers `[[` links between notes, pills with live titles, "Missing card", the "Linked from" section, and `links`/`backlinks` in the API, MCP, SDK and CLI.
- [Pinned cards](./pinning.md) covers pinning up to 12 cards from menus, `P` and the API, MCP, SDK and CLI, the "Pinned" row above Everything, reordering by drag and keyboard, the cap, unpinning on archive and Trash, `is:pinned`, and pins in exports and imports.
- [Search operators](./search-operators.md) covers `-` exclusions, uppercase `OR` and parentheses in search, smart folders, the API, CLI and MCP, the "Exclude" and `OR` suggestions, excluded pills, hidden cards and the `?` sheet's "Search" group.
- [Tables in notes](./note-tables.md) covers `/table`, cell keys, the ⋯ menu and Alt+F10, pasting into cells, Focus, round-trips of existing tables, literal tables, and table text on tiles.
- [Card processing](./card-processing.md) covers the background work after a save (stages, AI tags and summary), read through the local Core Worker's Workflow runs, logs, stored files and crons in Cloudflare's Local Explorer.
- [Save by email](./save-by-email.md) covers the Settings switch, mail from the sign-in email becoming link and note cards tagged email, attachments as their own cards, and what's refused or dropped.
- [Language](./language.md) covers Settings → Appearance → Language, switching in place with Undo, the account's choice beating the cookie, formats and plurals per language, translated server errors, the `en-XA` pseudo-locale break-it pass, and `locale` in `/v1/me` and `teak whoami`.
- [Opening links](./open-links.md) covers opening a link card's page through `/open/<cardId>`: the check, the archived copy when the page is gone (its bar, sandboxed frame, ⋯ menu at 390 px and missing state), "This card isn’t available", and the card dialog's "Archived copy" chip.
- [Import](./import.md) covers Settings → Import & export → Import: the source picker, CSV files with their header aliases and the missing url column error, text files of links, duplicates skipped by URL key, a Teak archive with one file that fails extraction while the rest import, and the failed-rows report.
- [Export](./export.md) covers Settings → Import & export → Export: starting (a double-click never cancels), progress, the ready archive with when the next export can start, and the weekly limit.
- [Saved copies of pages](./page-archive.md) covers a link's saved copy: the side panel's Details row in every state, server and extension copies, Refresh details, `archive` and `POST /v1/page-snapshots/upload` in the API, the sandboxed object, and the backfill.
- [Reader view](./reader.md) covers the card dialog's Preview · Read toggle and the reader in every state, article extraction and its summary, search by article text, `kind: "article"` in the API, MCP, SDK and CLI, and the backfill.
- [Highlights](./highlights.md) covers highlighting in the Read tab (the button, `H`, the touch bar), notes and removal with Undo, merges and caps, the panel's "Highlights · N" list and jumps, the frozen copy and article of a highlighted link, imported highlights, and highlights in the API, MCP, SDK and CLI.
- [Docs site](./docs.md) covers the sidebar's groups and order, page rendering in light, dark and 390px, agent-only text kept to the `.md` mirrors, and link checks.

- [Apple app](./apple.md) covers the iPhone, iPad and Mac app against the local E2E stack: the More menu, archive, folders, tags, Revisit, done toggles, link pills and the share extension's tags and note.
- [Android app](./android.md) covers the Android app on the phone and tablet emulators against the local E2E stack: archive, folders, tags, Revisit, done toggles, link pills, search chips and the share sheet's tags and note.
- [Browser extension](./extension.md) covers signing the Chrome extension in, the Alt+Shift+S save shortcut and its icon states, and the "Already in Teak" badge, in Chromium under a virtual display.
- [Installed web app](./web-install.md) covers installing the web app, the manifest and icons, and the share target: shared text filling the composer, shared files uploading, and a share made while signed out.
- [Raycast](./raycast.md) covers the Raycast commands, card actions and AI tools through the extension's own API client.

## Not mapped yet

Add a file here when a change touches one of these: the extension's popup, context menu and inline buttons (their language follows the account, see [Language](./language.md)), and billing ("Upgrade to Pro" with Polar's sandbox). The Apple and Android apps need a Mac with Xcode or the Android SDK; cloud sessions have neither.
