# Plan: Real tests, more e2e, agent test guidance, current test deps

## Context

Teak has about 310 test files, but a large share give false confidence:
- Slop: tests that assert literals they just created (`cardProcessing.test.ts` has ~22 of 29 like `const args = {cardId}; expect(args).toHaveProperty("cardId")`), `toBeDefined` on module exports (39 sites), `expect(true).toBe(true)`, constant-value assertions, ~32 files that `readFileSync` source and grep it, CSS class assertions, mock-call-only db chain checks, a "coverage.test.ts" that mocks to hit dead code.
- 22 unawaited `.rejects` assertions that can pass silently.
- 18 test files never run: 16 colocated convex `*.test.ts` outside `__tests__` and the vitest include list, `packages/ui/src/lib/__tests__/prefetchCardMedia.test.ts`, `apps/safari-extension/tests/companion.test.ts`.
- Duplicate test files (3x colorUtils, 2x auth, 2x linkMetadata, 11 colocated vs `__tests__` pairs).
- Core logic untested: `workflows/cardProcessing.ts` orchestration, palette/renderables steps, `dataImport.ts`, `fileUploads.ts`, `card/uploadCard.ts`, `idempotency.ts`, `publicApiHttpValidation.ts`, CLI runtime and commands, large UI hooks.
- No CI runs unit tests or coverage; no thresholds anywhere. `apps/web` Playwright specs `test.skip` when elements are missing, so they can pass while testing nothing.

Goal: fewer, better tests that fail when behavior breaks; wider e2e coverage; a written testing contract agents follow; unit tests + coverage gates on PRs; test deps at latest.

Decisions from user: unit tests only on PRs (no local e2e in CI); rewrite slop + add convex-test coverage for high-value areas (not a full migration); adopt Playwright test agents and Playwright MCP.

## Status (2026-09-29)

- Phase 0 blocked: `bun install` gets a 403 fetching the `electron/node-gyp` git tarball from `api.github.com` / `codeload.github.com` in the cloud container. The environment network policy must allow those hosts before the lockfile can be regenerated. Target note: pin `@next/playwright` to the installed `next` version (16.3.3) rather than 16.3.7.
- Phase 1 done except item 5: orphaned convex tests moved and merged (1993 unit tests across 132 files pass), nested `__tests__/__tests__` flattened, 22 async assertions awaited (none were hiding failures), UI script finds every test file (fixed the stale `prefetchCardMedia` test it exposed), Safari companion test in root `test`.
- Phase 5 part 1 done: `.github/workflows/unit-tests.yml`.
- Phase 1 item 5 (e2e skips) deferred until the local stack can run, so hard assertions are verified rather than guessed.

## Phase 0: Upgrade test dependencies (do first, one commit per tool)

| Package | Where | Now | Target |
|---|---|---|---|
| `@playwright/test` | `apps/web`, `packages/tests` | 1.62.1 | 1.63.x (bump both together) |
| `@axe-core/playwright` | `packages/tests` | 4.12.1 | 4.13.x |
| `@next/playwright` | `apps/web` | 16.3.0 | 16.3.7 |
| `vitest` | `packages/convex` | 4.1.11 | 5.0.x |
| `convex-test` | `packages/convex` | 0.0.56 | 0.0.60 |
| `@types/bun` | `apps/docs`, `packages/tests` | 1.4.0 | 1.4.2 |
| `@playwright/mcp` | root devDep (new) | n/a | 0.0.83 |

Breaking-change checks:
- Vitest 5: unawaited async assertions now fail (good, surfaces bugs), `clearMocks` default true, reporter output goes to `.vitest/` (add to `.gitignore`), strict locator/`vi.mock` hoisting rules. Run the 7 edge-runtime files to confirm `@edge-runtime/vm` still works.
- convex-test 0.0.58+: queries/mutations throw on `fetch`/`setTimeout`. Fix any test that relied on it.
- Run `bun install`, regenerate `bun.lock` with Bun only, then `bun run --cwd packages/tests test` (validates `playwright.config.test.ts` project graph).

## Phase 1: Make every test actually run, and fail honestly

1. **Orphaned tests**: move the 16 colocated convex `bun:test` files into `packages/convex/__tests__/` mirroring the source path, merging with existing duplicates (keep the stronger assertions, delete the rest). Files: `card/{processingStatus,quoteFormatting}`, `linkMetadata/{instagram,parsing,url,x}`, `shared/{apiKeyFormat,constants,linkCategories}`, `shared/utils/{colorUtils,linkCategoryResolver,linkDetection,safeUrl,timeSearch}`, `workflows/steps/categorization/providers/{common,providers}`.
2. **UI script**: replace the hardcoded `find` directory list in `packages/ui/package.json` with `find src -name '*.test.*'` so new test dirs (and `prefetchCardMedia.test.ts`) are picked up. Keep the per-file loop if it exists for module-mock isolation; otherwise switch to `bun test src --isolate`.
3. **Safari companion**: add `apps/safari-extension/tests/companion.test.ts` to the root `test` script (it has no package.json).
4. **Unawaited rejects**: add `await` to all 22 `expect(...).rejects` sites (listed in `fetchMetadata.test.ts`, `manager.test.ts`, `categorization/index.test.ts`, `aiMetadata/generators.test.ts`, `__tests__/__tests__/auth.test.ts`, `categorization/mutations.test.ts`, `linkMetadata_workflow.test.ts`, `e2eCleanup.test.ts`). Add a lint guard: Biome/oxlint rule for floating promises if available in the repo's linter, else a small `scripts/check-test-hygiene.ts` (see Phase 5).
5. **Silent e2e skips**: in `apps/web/src/tests/*.e2e.ts`, replace `test.skip` when an element is absent with hard `expect(...).toBeVisible()`. Keep only the credential-gated skip, but make it fail when `CI` is set.
6. **Duplicates**: collapse `__tests__/__tests__/` into `__tests__/` (auth, getFileUrl, colorUtils).

## Phase 2: Delete slop, replace with behavior tests

Rule applied per file: delete a test if deleting the code under test would not make it fail, or if it only restates the implementation. Replace only where the behavior matters.

Delete outright:
- Module-exists files: `packages/convex/__tests__/{index,cards,http,auth.config}.test.ts`, `__tests__/ai/{schemas,models}.test.ts`.
- `toBeDefined`/constant-only tests in `billing.test.ts`, `auth.test.ts`, `workflows/screenshot.test.ts`, `manager.test.ts` (`WORKFLOW_MAX_PARALLELISM`), `settingsConstants.test.ts`, `apps/mobile/__tests__/hooks/{useCardActionsMobile,useCardOperations}.test.ts`, `haptics.test.ts:95`.
- Literal-echo tests in `__tests__/workflows/{cardProcessing,cardCleanup,linkEnrichment}.test.ts` (keep the `resolveCardProcessingDurationMs` / `createMissingCardWorkflowResult` cases).
- `__tests__/workflows/steps/categorization/coverage.test.ts`.

Replace source-grep tests (~32 files) with behavior tests:
- Convex (`importWorkflow.test.ts`, `schema.test.ts`): convex-test that inserts/reads the table or drives the import to `limitReached`.
- UI previews and `BulkActionBar`: render with `renderToStaticMarkup` (existing pattern in `*.contract.test.tsx`) and assert visible text, roles, `href`/`src`, not class strings. Same for `FileTextPreview.test.tsx:48`, `LinkPreview.test.tsx:54`.
- `apps/web/src/__tests__/{searchWiring,authRouteGuard,nativeAuthRoute}.test.ts`: call the exported route guard / handler with a request and assert redirect or response.
- `apps/desktop/src/__tests__/*Wiring*.test.ts` and `apps/mobile/__tests__/components/{native-ui-regressions,CardItem,CardPreviewSheet}.test.ts`: extract the logic being grepped (IPC handler maps, deep-link parsing, menu templates) into pure functions if not already, test those, and keep at most one small wiring assertion per regression that cannot be reached otherwise, with a comment naming the bug.

Replace mock-chain tests (`ai/queries.test.ts`, `linkMetadata.test.ts`, `card/updateCard.test.ts`, cardCleanup handler test) with convex-test: seed rows, call the function via `t.query`/`t.mutation`, assert returned data and db state. Keep `shared/hooks/useCardActions.test.ts` and `telemetry/sentry.test.ts` but cut assertions to user-visible outcomes (toast, returned value, captured event payload) instead of call counts.

## Phase 3: New real unit/integration tests (priority order)

Use and extend existing helpers: `packages/convex/occContention.test.ts` fixtures (`insertCard`, `drainCardSearchTagSync`), `securitySessions.test.ts` Better Auth setup (`betterAuthTest.register`, `t.withIdentity`), `__tests__/helpers/{session,r2Mock,publicApiHttp}.test-utils.ts`. Extract shared convex-test setup (modules glob, component registration, `insertUser`, `insertCard(type)`) into `packages/convex/__tests__/helpers/convexTest.test-utils.ts`.

Convex test placement: move convex-test suites under `packages/convex/__tests__/integration/` and change `vitest.config.ts` `include` to a glob (`__tests__/integration/**/*.test.ts` plus the 7 existing root files, or move those too), so new files are not forgotten.

1. **Card processing workflow** (`workflows/cardProcessing.ts`): convex-test with `t.finishAllScheduledFunctions` driving a card of each type through the workflow; mock only network/AI boundaries. Assert final `processingStatus` per stage, skip paths (card deleted mid-run, unsupported type), retry on transient step failure, and that failures leave a consistent `processingStatus` (AGENTS.md invariant).
2. **Steps**: `steps/palette.ts`, `steps/renderables/{analyzeImage,generateFilePreview,generateVideoThumbnail,mutations}.ts`, `steps/linkMetadata/retryable.ts`, `steps/screenshot/retryable.ts`. Pure logic as bun tests, db effects as convex-test.
3. **Uploads and import**: `fileUploads.ts`, `card/uploadCard.ts`, `importUpload.ts`, `dataImport.ts`, `idempotency.ts` (same key returns same card, different payload conflicts).
4. **Public API validation**: `publicApiHttpValidation.ts`, `publicApiHttpShared.ts` as table-driven tests (valid/invalid bodies, limits, error codes).
5. **Search**: `shared/search/tokenization.ts`, `card/searchDocuments.ts`.
6. **CLI** (`apps/cli`, only 2 tests today): `runtime.ts` (`readCredentials`/`clearCredentials` against temp dirs like `logout.test.ts`, `exitCodeFor`, `readJson`), `format.ts:formatDetail`, and each commander command in `index.ts` via `program.parseAsync` with a fake client, asserting stdout/exit code.
7. **UI hooks**: `hooks/useCardModal.ts`, `useSettingsController.ts`, `useInfiniteScroll.ts`, `text-editor/{markdownLink,markdownTask}.ts`. Extract reducers/pure helpers where the hook is too React-bound; test those.

Where helpful, add `fast-check` (4.10.x) property tests for parsers: `linkDetection`, `safeUrl`, `timeSearch`, `quoteFormatting`, tokenization.

## Phase 4: More e2e tests

Production suite (`packages/tests`, follow its README: numbered journeys, dedicated accounts in `01-signup.setup.ts`, `run-state.ts`, `helpers/prod.ts`):
- New `14-card-types.e2e.ts`: create each of the 8 types through the UI and assert the rendered result: link from composer (metadata title), image from URL, video upload renders player with thumbnail, audio renders player (and transcript when processed), document shows preview/thumbnail. Poll processing via the API client (`clientFor`) rather than sleeps.
- Extend `09-web-product-surfaces`: permanent delete and empty trash.
- Extend `11-quote-favorites-filters`: keyword tag chips, hex/hue filters.
- Extend `04-cli.e2e.ts`: `update`, `bulk`, `changes`, `rm`, `fav`.
- Extend `extension/save-page.e2e.ts`: save current page URL from popup.
- Use Playwright 1.63 features: `toMatchAriaSnapshot` for card modal and settings structure (stable, agent-readable), `test.step` with `subtitle`/`params`, trace `snapshots: { dom, aria, screen }`.
- Add each new project to `playwright.config.ts` and update `playwright.config.test.ts`.

Local suite (`apps/web/src/tests`), run manually or by agents against the headless stack:
- Seed a verified user automatically in `global.setup.ts` (currently a no-op) using the internal test-setup endpoint described in `.agents/headless-development.md`, so specs no longer need `E2E_BETTER_AUTH_USER_*` to run.
- Add `seed.spec.ts` (needed by Playwright test agents) that signs in and lands on `/`.
- Fill `fixtures/` with small real files (png, pdf, mp4, webm, md) reused from `packages/tests/src/helpers/file-formats.ts` where possible.

## Phase 5: CI and coverage gates (unit only)

- New `.github/workflows/unit-tests.yml` on `pull_request` and `push: main`: Bun from `packageManager`, `bun install --frozen-lockfile`, `bun run test` (turbo, affected where possible via `--affected`), upload `coverage/` as artifact. No e2e.
- Coverage thresholds: add `[test] coverageThreshold` in each workspace `bunfig.toml` (or root) set at current measured value minus 1 point, per workspace, then ratchet. Add `coverageSkipTestFiles = true` and `coveragePathIgnorePatterns` for `_generated`. Vitest: `coverage.thresholds` in `vitest.config.ts` with `@vitest/coverage-v8`.
- Set `CLAUDECODE=1`/`AGENT=1` is not needed in scripts: Bun and Vitest auto-detect agents. Remove the hardcoded `CLAUDECODE=1 AGENT=1` from `apps/web` `test` script so humans get normal output.
- `scripts/check-test-hygiene.ts` (bun test'd, run in `lint`): fails on `expect(true)`, `@ts-nocheck` in new test files, `readFileSync` of non-fixture source in tests, unawaited `.rejects`/`.resolves`, `test.only`, and test files outside the paths each workspace script runs. Chip away at the 110 `@ts-nocheck` files opportunistically, not in this change.

## Phase 6: Agent testing guidance

New `.agents/testing.md` (linked from root `AGENTS.md` Verification section, and from `packages/convex/AGENTS.md`, `packages/ui`, `apps/web`, `packages/tests` nested AGENTS.md). Content:

- **Which layer**: pure function → `bun test`; Convex query/mutation/action/workflow → convex-test under `__tests__/integration` (vitest, edge-runtime); UI component → `renderToStaticMarkup` + visible text/roles; cross-surface or real-browser journey → `packages/tests` (prod) or `apps/web/src/tests` (local).
- **Where files go and how they run**: exact paths per workspace; a test not matched by the workspace script is a bug.
- **Rules (with good/bad examples from this repo)**: assert outcomes, not calls; never read source files to assert; no assertions on class names or constants; mock only external boundaries (network, AI providers, R2, time); always `await` async assertions; one behavior per test, name it as the behavior; delete tests that would pass with the code removed; no `test.skip` on missing UI; unique markers and cleanup for any data created against real backends (from `.agents/skills/teak/SKILL.md`).
- **Before finishing**: write the failing test first for bug fixes and see it fail; run the narrowest test, then `bun run test --filter=<pkg>`; check coverage did not drop.
- **Agent tooling**:
  - Bun 1.4: agent output mode is automatic under Claude Code; `bun test --changed`, `--parallel`, `--bail`, `--rerun-each=20` to prove a flake fix, `--randomize --seed` to find order dependence.
  - Vitest 5: `agent`/`minimal` reporter auto-enabled, `--detect-async-leaks`, test tags, `vi.when()`.
  - Playwright 1.63: `--last-failed`, `--only-changed`, trace viewer with aria snapshots, `toMatchAriaSnapshot`, `page.consoleMessages()`/`pageErrors()` for debugging, `locator.ariaSnapshotJSON()`.
  - Playwright test agents: `npx playwright init-agents --loop=claude` generates planner/generator/healer under `.claude/agents/`; planner writes plans to `apps/web/specs/`, generator writes specs from them, healer repairs failing specs. Human reviews generated specs against the rules above before merge (healer must not weaken assertions or add skips).
  - Playwright MCP: add `@playwright/mcp` to project `.mcp.json` so agents can drive the local app at `http://localhost:3000` to verify UI work, per root AGENTS.md "verify in the real interface".
- Update `apps/web` and `packages/tests` README/AGENTS.md with how to run the local suite headlessly (`PLAYWRIGHT_SKIP_WEBSERVER=1` against `bun run dev web --headless`).

## Suggested PR sequence

1. Deps upgrade (Phase 0).
2. Run-everything + honesty fixes (Phase 1) and CI workflow without thresholds (Phase 5 part 1).
3. Slop removal and replacements (Phase 2), one PR per workspace.
4. New convex-test coverage (Phase 3, items 1 to 5), then CLI and UI (6, 7).
5. Coverage thresholds + hygiene script (Phase 5 part 2).
6. E2E additions (Phase 4) and agent guidance + Playwright agents/MCP (Phase 6).

## Verification

- `bun run test` at root passes; `bun run --cwd packages/convex test:edge` passes on Vitest 5.
- Count check: number of test files executed per workspace (from runner output) equals the number of `*.test.*` files on disk in that workspace.
- Mutation spot check on key new tests: temporarily break `cardProcessing.ts` stage transition, `idempotency.ts` key match, and a `publicApiHttpValidation.ts` rule; the new tests must fail.
- Coverage report per workspace shows increase over baseline recorded before Phase 2; thresholds enforce it.
- `bun run --cwd packages/tests test` validates the Playwright project graph; `e2e:prod:local` passes with new journeys (needs prod e2e credentials, run by maintainer or nightly `prod-e2e.yml`).
- Local suite: headless stack (`bun run setup`, `bun run dev web --headless`), then `bun run --cwd apps/web test:e2e` with zero skipped tests.
- New `unit-tests.yml` green on the PR.
- `bun run verify:all` and pre-commit hooks pass (no `--no-verify`).
