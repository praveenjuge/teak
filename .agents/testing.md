# Testing guide

How to write tests in Teak that fail when behavior breaks, and pass when it does not. Read this before adding, changing, or deleting a test. It applies to people and agents alike.

## The one rule

A test earns its place only if it fails when the behavior it names is broken. Before you finish, ask: "If I deleted or broke the code under test, would this test fail?" If not, it is not a test. Delete it or rewrite it.

## Pick the layer

| What changed | Test with | Where it lives | Run it |
| --- | --- | --- | --- |
| Pure function (parsers, formatters, URL rules) | `bun test` | the workspace's test directory (table below) | `bun test <path>` |
| Convex query, mutation, action, or workflow step logic | `bun test` with the helpers in `packages/convex/__tests__/helpers/` | `packages/convex/__tests__/<mirrors source path>` | `bun run --cwd packages/convex test:unit` |
| Convex behavior that depends on the real database, auth sessions, or components | `convex-test` on Vitest (edge runtime) | `packages/convex/*.test.ts`, listed in `packages/convex/vitest.config.ts` | `bun run --cwd packages/convex test:edge` |
| Files Worker Workflow behavior only the real engine decides (retries, a `NonRetryableError` ending a step, what reaches `run()` after a step fails) | `bun test` with Wrangler's `createTestHarness` (Miniflare's Workflows engine) and a local server standing in for Convex | `apps/files-worker/src/**`, like `src/workflows/cardProcessing/engine.test.ts` | `bun test <path>` in `apps/files-worker` |
| Web React UI (components, hooks, screens, lib) | `bun test` + `renderToStaticMarkup` | a `__tests__` folder beside the code, e.g. `apps/web/src/components/cards/__tests__/` | `bun run --cwd apps/web test` |
| A real browser flow or a cross-surface journey (web, API, CLI, MCP) | [e2e](https://e2e.tester.army/docs) against the local E2E stack and the WorkOS emulator | `packages/tests/src/web/` for web surfaces, `packages/tests/src/journey/` for journeys (read `packages/tests/README.md` first) | `bun run --cwd packages/tests e2e`; the `E2E` workflow runs it daily and on demand |

Prefer the lowest layer that can observe the behavior. Move up a layer only when the behavior lives in the integration: a query index, an auth session, a browser API.

## Where files go

Each workspace script runs only the files it matches. A test file outside these paths never runs, and that is a bug.

| Workspace | Test files |
| --- | --- |
| `packages/convex` | `__tests__/**/*.test.ts` (Bun). Root `*.test.ts` files listed in `vitest.config.ts` (Vitest). Do not colocate Bun tests next to source files. |
| `apps/web` | `src/**/*.test.{ts,tsx}` (Bun, one process per file). Tests sit in the `__tests__` folder beside the code they cover; `src/__tests__` holds route, `next.config.ts` and cross-cutting wiring tests. |
| `packages/tests` | `src/**/*.e2e.ts` (e2e; each `e2e*.config.ts` names the directories it runs), `src/**/*.test.ts` (Bun) |
| `apps/cli`, `apps/files-worker`, `packages/files-protocol` | `src/**` |
| `apps/raycast` | `src/__tests__/**` |
| `apps/extension` | `__tests__/**` |
| `apps/docs` | `lib/**` |
| `apps/apple` | `tests/*.test.ts` (run by the root `bun run test`) and Swift Testing in `Packages/TeakKit/Tests` |
| `apps/android` | `tests/*.test.ts` (run by the root `bun run test`) and JUnit in each module's `src/test` |
| repo scripts | `scripts/**/*.test.ts`, run by the root `bun run test` |

`bun run test` at the root runs all of it, and the `Unit Tests` workflow runs it on every pull request.

## Rules

**Assert outcomes, not implementation.**
- Assert returned values, database state, rendered text, roles, `href` and `src`, HTTP status and body, and CLI stdout and exit codes.
- Do not assert that a mock was called with a query-builder chain (`withIndex`, `eq`, `take`). Seed data and assert the result.
- Do not assert CSS class names or DOM nesting.

**Never test the source text.** Do not `readFileSync` a source file and `toContain` a string. Extract the logic into a function and call it. If a regression truly cannot be reached any other way, keep at most one such assertion and name the bug in a comment.

**Mock only boundaries you do not own.** That means network, AI providers, R2 storage, Polar, email, time, and native modules. Never mock the module under test or its sibling modules to reach a branch.

**Never re-implement the code in the test.** Copying a regex list or an `if` chain into the test and asserting on the copy proves nothing. Export the function and call it (see `apps/extension/lib/restrictedUrl.ts`).

**Always await async assertions.** `await expect(p).rejects.toThrow()`. An unawaited `.rejects` or `.resolves` passes even when the promise does the wrong thing.

**No filler.** None of these count as tests:
- `expect(true).toBe(true)`
- `expect(module).toBeDefined()`
- asserting a constant equals its own literal
- building an object in the test and asserting its own fields

**Keep tests hermetic.**
- Restore any `process.env` keys you change.
- Clear variables that other modules set at import time. For example, `next.config.ts` sets `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` whenever a commit SHA is present, as it is in CI.
- Do not depend on test order. Check with `bun test --randomize` and `bun test --seed=<n>`.

**One behavior per test, named as the behavior.** Write "refuses to auto-save chrome:// pages", not "test isValidUrl 3". Use `test.each` for tables of inputs.

**Browser tests:**
- Use `getByRole` and `getByLabel` locators, and web-first `expect` assertions. e2e matches names exactly and case-sensitively; pass `{ exact: false }` only when a fragment is the point.
- No agent steps (`agent.act`, `agent.assert`): the suite configures no model, so every step is a locator or an exact `expect`.
- Never `waitForTimeout`, and never wait for `networkidle`.
- Never `test.skip` when an element is missing. A missing element is a failure.
- Credential-gated skips are the only allowed skip.

**Data against real backends:**
- Use unique markers per run (`generateTestContent` in `packages/tests/src/web/fixtures.ts`).
- E2E accounts are WorkOS emulator users that exist only for the run. Each spec file makes its own (`createAccount` or `createApiAccount` in `packages/tests/src/helpers/app.ts`), and web specs get one per test from `packages/tests/src/web/fixtures.ts`. Files share nothing, so they can run in any order.
- Never point a test at production or staging accounts.

## Reuse before you write

- Convex:
  - `packages/convex/__tests__/helpers/` provides `withTestSession`, R2 mocks and public API HTTP helpers.
  - `packages/convex/occContention.test.ts` has `insertCard` and search sync fixtures.
  - `packages/convex/workosSessions.test.ts` shows WorkOS-backed sessions with `t.withIdentity`.
- E2E: `packages/tests/src/helpers/app.ts` (sign-up, hosted sign-in, API keys, deletion), `emulator.ts` (WorkOS users, emailed codes, session tokens), `page-hooks.ts` (page errors, blocked requests, Convex socket routing), `test.ts` (`retry`, `firstVisible`), `api.ts`, `cli.ts` and `mcp.ts`. Headless WorkOS sessions against staging: `scripts/lib/workos-test-session.ts`.
- Raycast: `createRaycastApiMock` in `apps/raycast/src/__tests__/raycastApiMock.ts`.

## Before you finish

1. For a bug fix, write the failing test first and watch it fail for the right reason.
2. Run the narrowest test, then `bun run --cwd <workspace> test`, then `bun run test` if the change crosses workspaces.
3. Break the code on purpose (flip a condition, delete a line) and confirm the new test fails. Then restore it.
4. Re-read the diff for skipped tests, unawaited assertions, and deleted assertions. Never delete or loosen an assertion just to make a test pass.

## Tooling that helps agents

**Bun (`bun test`, 1.4)**
- Output switches to failures only when Bun detects an agent (`CLAUDECODE=1` or `AGENT=1`), so there's no need to set this in scripts.
- `--changed[=<ref>]` runs only test files affected by changed files.
- `--only-failures`, `--bail`, and `--rerun-each=20` confirm a flake is really fixed.
- `--randomize` with `--seed=<n>` finds and replays order dependence.
- `--isolate` gives each file a fresh global, which shows whether a failure is a leak from another file.
- `--parallel=<n>`, `--shard=<i>/<n>`, and `--coverage --coverage-reporter=lcov` are also available.

**e2e (`packages/tests`)**
- `--last-failed`, `--repeat-each=<n>`, `--grep`, `--max-failures` and `path:line` selection.
- A failed test names its `trace.md` under `packages/tests/.e2e/<suite>/results/`: every step, the app's console errors and failed requests, and the screen at failure. Read it before re-running. `--trace on` keeps one for passing tests too.
- `--headed` shows the browser; `--video on` records every attempt.
- The e2e skill (`.agents/skills/e2e/`) covers writing and running tests; the full docs ship in `node_modules/e2e/docs`.
- Never run `e2e feedback`, even though the skill suggests it: it sends a report to the e2e maintainers. Tell the person what got in your way instead, and let them decide whether to report it. Keep `E2E_TELEMETRY_DISABLED=1` set, as the package scripts and `.mcp.json` do.

**e2e MCP (`e2e` in `.mcp.json`)**
- Opens live browser sessions on the running app (either stack), so you can check UI work at `http://localhost:3000` instead of relying on a passing build. Pass `packages/tests/e2e.config.ts` as `open_session`'s `config`; in a cloud session it drives the image's Chromium against the dev stack (`.agents/cloud.md`).
- Its `locate` tool checks a `screen.getBy…` locator against the current page and returns the exact line to put in a spec.
- It doesn't run specs; use `E2E_TELEMETRY_DISABLED=1 bunx e2e run <file>` in `packages/tests` with the E2E stack up (`bun run --cwd packages/tests e2e:stack`).
