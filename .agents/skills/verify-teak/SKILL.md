---
name: verify-teak
description: Drive the real Teak web app, REST API, CLI and MCP server the way a user does, and capture proof that a change works. Use before calling any Teak change done, to reproduce a bug, or when asked to verify, prove, demo or screenshot Teak behavior. Covers launching the dev stack, a read-only health check, feature-by-feature recipes in features/, evidence, and cleanup.
---

# Verify Teak

Prove a Teak change in the running app, not by a passing build: launch, check health, drive the touched features through their user entry points, keep the evidence, clean up. Per-feature recipes live in [`features/`](features/README.md); read its README first.

The primary surface is the web app at this checkout's `appOrigin` (each worktree has its own ports). Take every URL and port from `bun run dev --status` (`--json` for scripts: `stack.urls` and `ports`), never from a recipe. The REST API, CLI, MCP server, browser extension, and the Apple, Android and Raycast apps (which run against the local E2E stack) have their own recipes.

## Launch

```bash
bun run dev --detach
```

It starts the web app against the shared dev deployment (`dev:reminiscent-kangaroo-59`) with WorkOS staging sign-in and returns once ready (about 50 seconds cold, 10 warm); then run the doctor. The first signed-in load compiles routes, so "Loading cards" can show for up to a minute.

- The account is in `.agents/.state/stack.json` (`account.email`, `account.password`). A cloud session gets its own account with about 30 sample cards (`packages/convex/devSeed.ts`).
- When the change touches `packages/convex`, test this checkout's backend: start with `bun run dev --detach --push` (takes the push lease) and confirm with the doctor.
- Don't run plain `bun run dev` in the background: the agent tool stops it after 30 minutes.
- For destructive or schema-changing work, or without `CONVEX_DEPLOY_KEY`, use a local backend: `bun run dev --stop`, then `bun run dev --local --detach` (local Convex pushing this checkout, the WorkOS emulator, the Core Worker in Miniflare; `development.mdx`, "A local backend"). Its account is in `stack.json` with a new password each start, and both emulator sign-in buttons read "Continue". Link previews, screenshots, transcripts and embeddings don't run there.

## Doctor

Run it before the first drive and after anything surprising or failed:

```bash
bun .agents/skills/verify-teak/scripts/doctor.ts
```

Read-only. It checks the recorded stack is alive and ready, the web app answers (anonymous `/` redirects to sign-in), whether the live dev backend matches this checkout's `packages/convex`, and that the last push passed schema validation. Exit 1 means don't drive. A `!` backend line means the live backend isn't this checkout's: fine for frontend-only changes; for backend ones relaunch with `--push`. If the doctor passes but the UI is stuck (a spinner, "We couldn't check your session"), reload or sign in again before driving on.

## Drive

**Web:** the `e2e` MCP server in `.mcp.json`; open a session with `config: "packages/tests/e2e.config.ts"`. In a cloud session against the dev stack it attaches to a Chromium with a DevTools port, so a script can drive file choosers in the same browser (`apps/docs/content/docs/(open-source)/development.mdx`, "Cloud sessions in detail").

- `observe` lists nodes with role and accessible name; act with `tap`, `type`, `press`, `right_click`, `hover`, `select`, `upload`, `navigate`.
- Target nodes by role and accessible name from the feature files, never by coordinates unless a feature file says the control has no accessible node.
- `locate` checks a locator against the live page and prints the spec line; use it to turn a proof into a regression test in `packages/tests`.
- Node ids are valid only for the newest observation; observe again after navigation.
- Each `open_session` starts signed out; sign in through the hosted WorkOS page ([sign-in](features/sign-in.md)).

**API, CLI and MCP:** mint a key with the helper, which stores it in the ignored `.agents/.state/verify/api-key.json` and prints only a masked prefix:

```bash
bun .agents/skills/verify-teak/scripts/api-key.ts mint     # then: export TEAK_API_KEY="$(jq -r .key .agents/.state/verify/api-key.json)"
bun .agents/skills/verify-teak/scripts/api-key.ts check    # 200 while the key works, 401 once revoked
bun .agents/skills/verify-teak/scripts/api-key.ts revoke   # in cleanup
```

The dev deployment serves the API and MCP at `https://reminiscent-kangaroo-59.convex.site` (`/v1/...`, `/mcp`). Run the CLI from this checkout ([api-cli-mcp](features/api-cli-mcp.md)). Never copy a key off the screen; prove keys with the helper.

**Data:** mark everything a run creates with `verify-<run-id>` (for example `verify-20261018-0427`) so concurrent runs on the shared account don't collide and cleanup finds exactly this run's data. Edit or delete seeded cards only through a recipe that restores them.

## Evidence

Every run writes to `.agents/.state/verify/<run-id>/` (ignored by git, kept by `bun run dev --stop`):

- `notes.md`: the doctor output at the top, then one line per step: feature id, entry point, action, handle used, what you observed.
- Screenshots: copy the file the `e2e` `screenshot` result names (`[Image: source: …png]`) in as `<feature-id>-<step>.png`.
- Video, when a reviewer should watch the flow: `start_recording`, then `stop_recording` returns the path; copy it in.
- API, CLI and MCP: command, stdout, stderr and exit code, saved with `tee`, keys and tokens replaced with `<redacted>`.

What counts as proof:

- The real user path (the button, shortcut, command or endpoint a user would use), not an internal setter, test-only endpoint or direct database write.
- The action and the resulting state, not only the final screen.
- Side effects read back from a second view: a reload, another route, the API, or Local Explorer for background work.
- A bug fix reproduces the bug first on the same path, then shows it gone.
- An unreachable step is reported with the route tried and the missing precondition. Never report a skipped entry point as verified through another.

Screenshots and video for a PR show only the seeded account and seeded or marked cards ("Pull requests" in `apps/docs/content/docs/(open-source)/development.mdx`).

## Cleanup

1. Permanently delete every card the run created: search the run marker, move them to Trash, then "Delete forever" ([card-actions](features/card-actions.md)), or `DELETE /v1/cards/<id>` then `?permanent=true` ([api-cli-mcp](features/api-cli-mcp.md)). Revoke every key: `bun .agents/skills/verify-teak/scripts/api-key.ts revoke`, plus any made in Settings ([settings](features/settings.md)).
2. Undo any seeded-card change (a favorite toggled, a tag added).
3. `close_session` every `e2e` session you opened.
4. Stop the stack only if this run started it (`bun run dev --stop`); never kill processes by name.
5. Confirm the run folder still holds the evidence.

## Reporting back

When another agent asked you to verify, you verify; you don't change product code. Meet "What counts as proof" above, then return the run id, the doctor output, one line per step (feature id, entry point, action, what you observed), the evidence paths, and every step you could not reach with its missing precondition.

## Keeping the map honest

The feature map is the source for how to verify Teak. A user-facing feature change updates its feature file in the same PR and drives the new recipe once. When a recipe fails because the app changed on purpose, fix the recipe; when the app is wrong, report the bug and keep the recipe. Run `.agents/skills/maintain-verification-skill` to audit the whole map when recipes start failing or before a release.
