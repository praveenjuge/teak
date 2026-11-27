# Teak verification map

This directory is how to verify Teak's user-facing behavior. Read this index, then use the matching feature file as the recipe. Launch, doctor, evidence and cleanup are in [`../SKILL.md`](../SKILL.md).

## Baseline preconditions

- The dev stack is running (`bun run dev --detach`) and `bun .agents/skills/verify-teak/scripts/doctor.ts` exits 0.
- The account is the one in `.agents/.state/stack.json`. Its vault is seeded (`packages/convex/devSeed.ts`, `packages/convex/card/defaultCards.ts`): text, link, quote, palette, image and video cards; the folder "Start here"; the smart folder "Moodboard" (`type:image type:palette`); and favorites, including the "Welcome to Teak…" card. Never assume the grid is empty or that a new card comes first.
- The run has a marker, `verify-<run-id>`, and an evidence folder, `.agents/.state/verify/<run-id>/`.
- Never drive a stack this run didn't health-check, and never drive the E2E suite's stack while `bun run --cwd packages/tests e2e` is running.

## Driving conventions

- Web steps go through the `e2e` MCP server (`open_session` with `config: "packages/tests/e2e.config.ts"`). Name nodes by role and accessible name exactly as written. `observe` again after every navigation: node ids expire.
- Single-key shortcuts (`N`, `U`, `/`, `f`, `e`, `x`, `g` sequences) fire only with focus outside a text field; press `Escape` or tap empty space first.
- Hover-only card buttons ("Favorite", "More actions", "Select", "Open link") are hidden until the card is hovered: `hover` it first, or `right_click` it for the same menu.
- Markers must not be color, style or time words ("orange", "minimal", "today"), or words Teak treats as commands ("fav", "trash", "archive"): search turns those into filters or navigates.
- API, CLI and MCP steps run from the repository root with the key from `scripts/api-key.ts` (see [api-cli-mcp](./api-cli-mcp.md)).
- Undo every favorite, tag, archive or folder change you make to a seeded card.

## Proof and skip reporting

- Capture the action and the resulting state: screenshots before and after, or the `observe` lines that changed.
- Prove persistence from a second view: reload, another route, a search, or a read through the API.
- Record the feature id and entry point with every artifact in `notes.md`.
- Report an unreachable path with the attempted step and the unmet precondition; never report a skipped entry point as verified through another.

## Feature entry contract

Each feature file has an H1 title and one paragraph on the user-visible behavior, then exactly four H2 sections in order: `Sub-features`, `How to get to it (user POV)`, `Driving it with <harness>`, `Gotchas`. `scripts/repo/verify-feature-map.test.ts` checks the shape, and that the list below names every feature file once by its H1 title. Name only user paths, stable handles, required state, commands and observable proof, not implementation.

## Features

- [Sign in and sign out](./sign-in.md) covers the auth redirect, WorkOS sign-in, and signing out.
- [Capture](./capture.md) covers the composer, the Focus editor, the "New" menu, uploads and audio recording.
- [Find](./find.md) covers search, qualifiers, the View menu, sidebar views, tags, folders, the command palette and empty states.
- [Card actions](./card-actions.md) covers the card dialog, favorites, archive, Trash, restore, delete forever and bulk selection.
- [Card tiles in the grid](./card-tiles.md) covers how each card type looks in the grid, its marks, and the hover, selection, focus and processing states.
- [Palette colors](./palette-colors.md) covers adding and removing a palette's colors in the card dialog, its limits, color search, and `addColors`/`removeColors` in the API, MCP, SDK and CLI.
- [Settings](./settings.md) covers the Settings pages, their nav and `G S` shortcut, theme, devices, API keys, plan and usage, and delete account.
- [API, CLI and MCP](./api-cli-mcp.md) covers the REST API, CLI and MCP server with an API key.
- [Teak in Claude](./claude-connector.md) covers the card view MCP clients render for Teak's card tools, the Claude plugin from this repository's marketplace, and the reviewer-account seed.
- [Link transcripts and video facts](./link-transcripts.md) covers Vimeo and podcast transcripts found by a spoken phrase, and YouTube's Channel, Length and Uploaded facts.
- [Card links](./card-links.md) covers `[[` links, their pills, "Missing card", "Linked from", and `links`/`backlinks` in the API, MCP, SDK and CLI.
- [Pinned cards](./pinning.md) covers pinning up to 12 cards from menus, `P` and the API, MCP, SDK and CLI, the "Pinned" row, reordering, unpinning, `is:pinned`, and pins in exports and imports.
- [Search operators](./search-operators.md) covers `-` exclusions, uppercase `OR` and parentheses in search, smart folders, the API, CLI and MCP, and their suggestions, pills and help.
- [Tables in notes](./note-tables.md) covers `/table`, cell keys, the ⋯ menu and Alt+F10, pasting, Focus, round-trips and table text on tiles.
- [Card processing](./card-processing.md) covers the background work after a save, read through the local Core Worker's runs, logs, files and crons in Cloudflare's Local Explorer.
- [Self-hosting](./self-hosting.md) covers `bun run deploy:self-host` (`self-host/.env`, `--with-secrets`), booting the self-host config with `wrangler dev`, the `default` AI Gateway, telemetry off until the self-hoster's own PostHog token, and `BILLING_DISABLED` giving every account Pro.
- [Save by email](./save-by-email.md) covers the Settings switch, mail becoming cards tagged email, attachments, and what's refused or dropped.
- [Language](./language.md) covers switching language with Undo, the account's choice beating the cookie, formats, plurals, translated errors, the `en-XA` pseudo-locale pass, and `locale` in `/v1/me` and `teak whoami`.
- [Opening links](./open-links.md) covers `/open/<cardId>`: the check, the archived copy when the page is gone, "This card isn’t available", and the "Archived copy" chip.
- [Import](./import.md) covers the source picker, CSV and text-file imports, skipped duplicates, a Teak archive with one bad file, and the failed-rows report.
- [Export](./export.md) covers starting an export, progress, the ready archive and the weekly limit.
- [Saved copies of pages](./page-archive.md) covers a link's saved copy: the Details row, server and extension copies, Refresh details, `archive` and `POST /v1/page-snapshots/upload`, and the backfill.
- [Reader view](./reader.md) covers the Preview · Read toggle, the reader, article extraction and search, `kind: "article"` in the API, MCP, SDK and CLI, and the backfill.
- [Highlights](./highlights.md) covers highlighting in the Read tab, notes and removal, the "Highlights · N" list, the frozen copy, imported highlights, and highlights in the API, MCP, SDK and CLI.
- [Errors and resilience](./errors.md) covers failed reads, saves and media: in-app error pages, the sidebar folders error, Tags' "Couldn't load your tags.", failed recordings, expired media, failed bulk deletes, sign-out failures, offline notices, account deletion and the palette's theme toggle.
- [Folder rules](./folder-rules.md) covers a manual folder's rules in its Edit folder dialog: "Add a rule", auto-tags, auto-file by search, the run toast and "Undo last run", the hidden-tag warning and the `like:`/`mood:` rejection.
- [Docs site](./docs.md) covers the sidebar, page rendering, agent-only text in the `.md` mirrors, and link checks.
- [Apple app (iPhone, iPad, Mac)](./apple.md) covers the app against the local E2E stack: the More menu, archive, folders, tags, Revisit, done toggles, link pills and the share extension.
- [Android app](./android.md) covers the app on phone and tablet emulators against the local E2E stack: archive, folders, tags, Revisit, done toggles, link pills, search chips and the share sheet.
- [Browser extension](./extension.md) covers signing in, the Alt+Shift+S save shortcut and icon states, and the "Already in Teak" badge, in Chromium under a virtual display.
- [Installed web app](./web-install.md) covers installing, the manifest and icons, and the share target, including a share while signed out.
- [Raycast](./raycast.md) covers the commands, card actions and AI tools.

## Not mapped yet

Add a file when a change touches: the extension's popup, context menu and inline buttons (their language follows the account, see [Language](./language.md)), and billing ("Upgrade to Pro" with Polar's sandbox). The Apple and Android apps need a Mac with Xcode or the Android SDK; cloud sessions have neither.
