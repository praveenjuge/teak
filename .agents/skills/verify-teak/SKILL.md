---
name: verify-teak
description: Drive the real Teak web app, REST API, CLI and MCP server the way a user does, and capture proof that a change works. Use before calling any Teak change done, to reproduce a bug, or when asked to verify, prove, demo or screenshot Teak behavior. Covers launching the dev stack, a read-only health check, feature-by-feature recipes in features/, evidence, and cleanup.
---

# Verify Teak

Prove a Teak change in the running app, not by a passing build. Launch the stack, check it is healthy, drive the features the change touches through their user entry points, keep the evidence, and clean up what the run made. The recipes for each feature live in [`features/`](features/README.md); read its README first.

The primary surface is the web app at `http://localhost:3000` (a worktree has its own port; `bun run dev --status` prints it). The REST API, CLI and MCP server are secondary surfaces with their own recipes, and so are the Apple and Android apps and Raycast, which run against the local E2E stack. The browser extension's shortcut and badge have a recipe too ([extension](features/extension.md)); its popup, context menu and inline buttons are not mapped yet.

## Launch

```bash
bun run dev --detach
```

It sets up the checkout, starts the web app against the shared dev deployment (`dev:reminiscent-kangaroo-59`), signs in through WorkOS staging, and returns once the app is ready: about 50 seconds cold, 10 warm. Ready means the command returned and the doctor below passes. The first signed-in page load still compiles routes, so the card grid can show the "Loading cards" skeleton for up to a minute the first time.

- The account and its password are in `.agents/.state/stack.json` (`account.email`, `account.password`). A cloud session gets its own account, seeded with about 30 sample cards (`packages/convex/devSeed.ts`).
- When the change touches `packages/convex`, the backend you test must be this checkout's. Start with `bun run dev --detach --push` to take over the push lease, and confirm with the doctor.
- Don't start plain `bun run dev` as a background command: the agent tool stops it after 30 minutes.
- For a run that must not share a backend (destructive or schema-changing work, or a session without `CONVEX_DEPLOY_KEY`), use a local backend instead: `bun run dev --stop`, then `bun run dev --local --detach` (a local Convex backend that pushes this checkout's backend as it changes, the WorkOS emulator and the Files Worker in Miniflare; `development.mdx`, "A local backend"). Its seeded account is in `stack.json` too, with a new password each start, and the emulator's sign-in buttons are both "Continue". Link previews, screenshots, transcripts and embeddings don't run there.

## Doctor

Run this before the first drive, after anything surprising, and after any failed drive:

```bash
bun .agents/skills/verify-teak/scripts/doctor.ts
```

It is read-only. It checks that the recorded stack is alive and ready, that the web app answers (anonymous `/` redirects to sign-in), whether the dev deployment's live backend matches this checkout's `packages/convex`, and that the last push didn't fail schema validation. Exit 1 means don't drive. A `!` line about the backend means the live backend isn't this checkout's: fine for a frontend-only change, not for a backend one (relaunch with `--push`). When the doctor passes but the UI is stuck (a spinner, "We couldn't check your session"), reload or sign in again rather than driving on.

## Drive

**Web:** the `e2e` MCP server in `.mcp.json`. Open a session with `config: "packages/tests/e2e.config.ts"`. In a cloud session, against the dev stack, the config attaches to a Chromium it starts with a DevTools port, so a script can drive file choosers in the same browser (`.agents/cloud.md`, "File uploads"); elsewhere it launches e2e's own Chromium.

- `observe` lists every node with its role and accessible name. Act with `tap`, `type`, `press`, `right_click`, `hover`, `select`, `upload`, `navigate`.
- Target nodes by role and accessible name from the feature files. Never by coordinates unless a feature file says the control has no accessible node.
- `locate` checks a locator against the live page and prints the line to use in a spec. Use it when you turn a proof into a regression test in `packages/tests`.
- Node ids are valid only for the newest observation. Observe again after navigation.
- Sign in through the hosted WorkOS page ([sign-in](features/sign-in.md)). Each `open_session` starts signed out.

**API, CLI and MCP:** mint a key for the seeded account with the helper, which keeps it in the ignored `.agents/.state/verify/api-key.json` and prints only its masked prefix:

```bash
bun .agents/skills/verify-teak/scripts/api-key.ts mint     # then: export TEAK_API_KEY="$(jq -r .key .agents/.state/verify/api-key.json)"
bun .agents/skills/verify-teak/scripts/api-key.ts check    # 200 while the key works, 401 once revoked
bun .agents/skills/verify-teak/scripts/api-key.ts revoke   # in cleanup
```

The dev deployment serves the API and MCP at `https://reminiscent-kangaroo-59.convex.site` (`/v1/...`, `/mcp`). Run the CLI from this checkout so you test this branch's code ([api-cli-mcp](features/api-cli-mcp.md)). Never copy a key off the screen: prove keys with the helper.

**Data:** mark everything a run creates with a unique marker, `verify-<run-id>` (for example `verify-20261018-0427`), so concurrent runs on the shared account never collide and cleanup finds exactly what this run made. Never edit or delete seeded cards except through a recipe that restores them.

## Evidence

Every run writes to `.agents/.state/verify/<run-id>/` (ignored by git, and kept by `bun run dev --stop`):

- `notes.md`: one line per step: feature id, entry point, the action, the handle used, and what you observed. Record the doctor output at the top.
- Screenshots: the `e2e` `screenshot` result names its saved file (`[Image: source: …png]`); copy it into the run folder as `<feature-id>-<step>.png`.
- Video, when a reviewer should watch the flow: `start_recording` and `stop_recording`, which returns the file's path; copy it into the run folder.
- API, CLI and MCP: the command, stdout, stderr and exit code, saved with `tee`. Replace keys and tokens with `<redacted>`.

What counts as proof:

- The real user path: the button, shortcut or command a user would use. Not an internal setter, a test-only endpoint or a direct database write.
- The action and the resulting state, not only the final screen.
- Side effects read back from a second view: reload the page, open the card from another route, or read it back through the API.
- A bug fix reproduces the bug first, on the same path, then shows it gone.
- A step you could not reach is reported with the route you tried and the missing precondition. Never report a skipped entry point as verified through another.

Screenshots and video for a PR follow `.agents/pull-requests.md` ("Screenshots and video"): only the seeded account and seeded or marked cards.

## Cleanup

1. Permanently delete every card the run created: search for the run marker, move the cards to Trash, then "Delete Forever" ([card-actions](features/card-actions.md)), or `DELETE /v1/cards/<id>` then `?permanent=true` ([api-cli-mcp](features/api-cli-mcp.md)). Revoke every key the run made: `bun .agents/skills/verify-teak/scripts/api-key.ts revoke`, and in Settings any key you created there ([settings](features/settings.md)).
2. Undo any seeded-card change a recipe made (a favorite toggled, a tag added).
3. `close_session` every `e2e` session you opened.
4. Stop the stack only if this run started it: `bun run dev --stop`. Never kill processes by name.
5. Confirm `.agents/.state/verify/<run-id>/` still holds the evidence.

## Keeping the map honest

The feature map is the maintained source for how to verify Teak. When a change adds or changes a user-facing feature, update or add its feature file in the same PR, and drive the new recipe once. When a recipe fails because the app changed on purpose, fix the recipe; when the app is wrong, report the bug and keep the recipe. `.agents/skills/maintain-verification-skill` audits the whole map: run it when recipes start failing or a release is near.
