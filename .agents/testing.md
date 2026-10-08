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
| Shared React UI | `bun test` + `renderToStaticMarkup` | `packages/ui/src/**/__tests__/` | `bun run --cwd packages/ui test` |
| A real browser flow or a cross-surface journey (web, API, CLI, MCP) | Playwright against the local stack and the WorkOS emulator | `packages/tests/src/web/` for web surfaces, `packages/tests/src/journey/` for journeys (read `packages/tests/README.md` first) | `bun run --cwd packages/tests e2e`; the `E2E` workflow runs it on every pull request |

Prefer the lowest layer that can observe the behavior. Move up a layer only when the behavior lives in the integration: a query index, an auth session, a browser API.

## Where files go

Each workspace script runs only the files it matches. A test file outside these paths never runs, and that is a bug.

| Workspace | Test files |
| --- | --- |
| `packages/convex` | `__tests__/**/*.test.ts` (Bun). Root `*.test.ts` files listed in `vitest.config.ts` (Vitest). Do not colocate Bun tests next to source files. |
| `packages/ui` | `src/**/*.test.{ts,tsx}` |
| `apps/web` | `src/__tests__/**` (Bun) |
| `packages/tests` | `src/**/*.e2e.ts` and `src/journey/*.setup.ts` (Playwright), `src/**/*.test.ts` (Bun) |
| `apps/cli`, `apps/files-worker`, `packages/files-protocol` | `src/**` |
| `apps/desktop`, `apps/raycast` | `src/__tests__/**` |
| `apps/extension`, `apps/mobile` | `__tests__/**` |
| `apps/docs` | `lib/**` |
| `apps/mac` | `tests/*.test.ts`, run by the root `bun run test` |
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
- Clear variables that other modules set at import time. For example, `next.config.ts` sets `SENTRY_RELEASE` whenever a commit SHA is present, as it is in CI.
- Do not depend on test order. Check with `bun test --randomize` and `bun test --seed=<n>`.

**One behavior per test, named as the behavior.** Write "refuses to auto-save chrome:// pages", not "test isValidUrl 3". Use `test.each` for tables of inputs.

**Browser tests:**
- Use `getByRole` and `getByLabel` locators, and web-first `expect` assertions.
- Never `waitForTimeout`, and never wait for `networkidle`.
- Never `test.skip` when an element is missing. A missing element is a failure.
- Credential-gated skips are the only allowed skip.

**Data against real backends:**
- Use unique markers per run (`generateTestContent` in `packages/tests/src/web/fixtures.ts`).
- E2E accounts are WorkOS emulator users that exist only for the run: journeys use the accounts from `packages/tests/src/journey/01-signup.setup.ts`, and web specs get one per worker from `packages/tests/src/web/fixtures.ts`.
- Never point a test at production or staging accounts.

## Reuse before you write

- Convex:
  - `packages/convex/__tests__/helpers/` provides `withTestSession`, R2 mocks and public API HTTP helpers.
  - `packages/convex/occContention.test.ts` has `insertCard` and search sync fixtures.
  - `packages/convex/workosSessions.test.ts` shows WorkOS-backed sessions with `t.withIdentity`.
- E2E: `packages/tests/src/helpers/app.ts` (sign-up, hosted sign-in, API keys, deletion), `emulator.ts` (WorkOS users, emailed codes, session tokens), `api.ts`, `cli.ts` and `mcp.ts`. Headless WorkOS sessions against staging: `scripts/lib/workos-test-session.ts`.
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

**Playwright (`packages/tests`)**
- `--last-failed`, `--only-changed`, `--repeat-each=<n>`, and `--fail-on-flaky-tests`.
- Traces (`--trace on`) show DOM and aria snapshots per step.
- `page.consoleMessages()` and `page.pageErrors()` help explain failures.
- `toMatchAriaSnapshot` pins page structure by role and name instead of markup.

**Playwright test runner MCP (`playwright-test` in `.mcp.json`)**
- Lists, runs, and debugs the `packages/tests` specs from an agent session. Start the stack first (`bun run --cwd packages/tests e2e:stack`).
- For planner, generator, and healer agents, run `bunx playwright init-agents --loop=claude` in `packages/tests`. Before using them, add the rules above: specs end in `.e2e.ts`, and the healer must never skip tests or weaken assertions.

**Playwright MCP (`playwright` in `.mcp.json`)**
- Drives a real browser, so you can check UI work in the running app at `http://localhost:3000` instead of relying on a passing build.
