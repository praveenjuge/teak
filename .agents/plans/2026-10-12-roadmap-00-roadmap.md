## Goal

Ship the library features Teak lacks today (folders, archive, search qualifiers, reader view, automation, public links and more) as 19 separate plans. Each phase is one PR, deployed and verified in production on its own before the next one starts.

## Success Criteria

- Every phase below merges as its own PR with green CI, a proof bundle (video plus screenshots), and a production smoke test.
- No phase breaks a shipped client: native iPhone, iPad, Mac and Android apps keep working against the new backend without an update.
- Every new feature works on the web and through the public API, MCP, SDK and CLI, and is free on all plans (the free 200-card cap still applies).
- `apps/docs` documents each feature in the month it ships.

## Context And Current Facts

- We picked the library features that fit Teak with the least new infrastructure. Teak has no folders, archive, search qualifiers, reader view, automation or public links today, while a lot of backend data (EXIF, link author/date, document text, a reprocess workflow, API sort) already exists but is unused in the UI.
- Local `main` was at `cb493fc` when this roadmap was written (Kernel removed; rendering now runs in the Cloudflare Files Worker). Two later commits replaced Sentry with PostHog (`5eb79e5`, `35817df`).
- Phase 1 is being implemented on branch `claude/amazing-volta-697ngf` while these plans are written. Its plan describes the roadmap as approved; it will be updated to match the implementation.
- Verified repo facts every phase leans on:
  - `patchCardWithSearchSync` (`packages/convex/card/searchDocumentHelpers.ts:152`) only re-syncs search when a key in its local `searchableFields` list changes (`content`, `notes`, `aiSummary`, `aiTranscript`, `metadataTitle`, `metadataDescription`, `tags`, `aiTags`, `userId`, `type`, `isDeleted`, `isFavorited`, `createdAt`). Any new search-affecting card field must be added to that list.
  - `cards.isFavorited` and `isDeleted` are `v.optional(v.boolean())`; search and tag rows store `undefined` for "not deleted", which is why new flags use `v.optional(v.literal(true))`.
  - Free cap: `FREE_TIER_LIMIT = 200` in `packages/convex/shared/constants.ts`; usage is sharded in `card/cardUsage.ts` and counts every card that is not in Trash.
  - Rate limits live in `RATE_LIMIT_CONFIG` (`packages/convex/shared/rateLimits.ts`). Refresh details (formerly "Re-run AI") uses `cardReprocess` (6/min per user) and `cardReprocessPerCard` (1/min per card); the API answers 429 with `retryAt`; the app gets a returned refusal.
  - The public card JSON is an explicit allow-list (`serializeCard` in `packages/convex/publicApiHttpValidation.ts`). New fields appear in the API only when added there and in `publicApiOpenApi.ts`.
  - Backfill precedent: `operationalRetention.ts cleanupExpiredRecords` (cursor, `dryRun` defaulting to true, bounded batches, self-scheduling continuation). `packages/convex/migration/` holds only `exportBetterAuth.ts` today.
  - Backend Deploy (`.github/workflows/backend-deploy.yml`) waits for a compatible Files Worker with `scripts/check-files-readiness.ts --prod --wait`. The worker deploys separately with `bun run --cwd apps/files-worker deploy` (wrangler). A phase that adds a worker op adds it to that script's `required` list.
  - Docs have no per-feature pages: features are sections of `apps/docs/content/docs/features.mdx`; import and export live in `content/docs/(data)/`; API and MCP in `content/docs/(developers)/api.mdx` and `mcp.mdx`; CLI in `content/docs/(apps)/cli.mdx`. Changelog entries are one file per month (`content/changelog/october-2026.mdx` exists; create `november-2026.mdx` when a phase ships in November).

### Path corrections found while verifying the roadmap

- `occContention.test.ts` is `packages/convex/occContention.test.ts` (a root Vitest file), not under `__tests__/`.
- Every "convex-test" file (`folders.test.ts`, `tagOperations.test.ts` and so on) must be a root `packages/convex/*.test.ts` listed in `packages/convex/vitest.config.ts`. Bun tests go in `packages/convex/__tests__/` mirroring the source path.
- `steps/metadata.ts` is `packages/convex/workflows/steps/metadata.ts`; `fetchMetadata.ts` is `workflows/steps/linkMetadata/fetchMetadata.ts`. Document text is extracted by `extractFileTextForAiForKey` in `workflows/fileProcessing.ts`.
- `max-w-7xl` is at `apps/web/src/app/layout.tsx:44`, not line 22.
- Account deletion deletes per-card rows in `accountDeletion.ts deleteAccountDataHandler`; `accountDeletionBatch.ts captureDeletionBatch` only selects the batch and its R2 keys.
- The `settings/*` components named by the roadmap live in `packages/ui/src/components/settings/`.
- `searchMobileCardSummariesPaginated` lives in `packages/convex/card/mobileCardSummaries.ts`.
- `SCHEMA_VERSION` lives in `packages/convex/export/constants.ts`; `serializeCard` is in `export/serialize.ts`.
- The SDK groups methods by resource (`client.cards.setFavorite`), so new SDK methods follow that shape (`cards.refresh`, `folders.list`).
- The CLI already has `teak tags rm <id> <names...>` (remove tags from one card). The Phase 6 global delete needs another verb.
- `packages/convex/raycast.ts` also reads the legacy list indexes, so Phases 2 and 19 must move it too.
- `#tag` (Phase 7) collides with the existing hex-color token: `#fff` or `#bad` parse as colors today.
- The Phase 4 primitives need new packages: `cmdk` for `command`, and `@radix-ui/react-tooltip`, `react-popover` and `react-switch`. `tw-animate-css` is a web dependency, not a `packages/ui` one.
- "Playwright MCP" in this roadmap means the repo's `e2e` MCP server (`.mcp.json`). Check its `tools` list for a network-throttling tool before relying on `browser_network_state_set`.

## Decisions (from the Q&A, apply to every phase)

| Topic | Decision |
|---|---|
| Surfaces | Web plus public API, MCP, SDK and CLI. No native iOS or Android UI now |
| Compatibility | Convex changes stay backward compatible: new args optional, `searchMobileCardSummariesPaginated` return shape unchanged |
| Pricing | Every feature is free on all plans; the free 200-card cap still applies |
| Backfills | Approved, done as dry-run-first paged internal mutations under `packages/convex/migration/` |
| Docs | Each phase updates `apps/docs` feature sections and the month's changelog, plus API, MCP and CLI docs when touched |
| Dropped | Webhooks (#17), source filter (#6), scoped API keys, AI tag preferences, Wrapped, reminders, "On this day", "delete unused tags" |

## Rules every phase follows

- Search-affecting writes go through `patchCardWithSearchSync` / `scheduleCardSearchSync` (`packages/convex/card/searchDocumentHelpers.ts`).
- New boolean flags are `v.optional(v.literal(true))`, which avoids the `isFavorited: false` vs `undefined` mismatch.
- New indexes are added beside the old ones; legacy indexes are dropped only in Phase 19.
- New workflow steps are appended at the end of `workflows/cardProcessing.ts` so in-flight journals replay.
- New user tables are covered by account deletion (`accountDeletionData.ts ancillaryPage`, per-card rows in `accountDeletion.ts deleteAccountDataHandler`), card hard delete (`card/deleteCard.ts`, `workflows/cardCleanup.ts`), and new R2 keys by `cardStorageObjectKeys` (`storage/r2.ts`).
- Public API checklist, in order: internal function in `publicApi*.ts` → handler in `publicApiHttp*.ts` → `executePublicApiOperation` (`publicApiHttp.ts`) → route plus OPTIONS in `http.ts` → `publicApiOpenApi.ts` → `mcp/tools.ts` → `client/sdk.ts` → `apps/cli/src/index.ts` plus `library.ts`.
- Files Worker changes deploy before Convex and web.

## UI bar for every phase: polished, minimal, classy

- Match Teak's look: shadcn new-york primitives from `packages/ui/src/components/ui`, `lucide-react` icons, the existing type scale, spacing and muted palette. No new visual language, and no chart or animation libraries.
- Minimal: one primary action per surface; secondary actions go in menus. Quiet empty states with one sentence and one action. No badges or counters unless they help a decision.
- Classy details: consistent 150–200ms easing on hover and open using the existing `tw-animate-css` classes (imported in `apps/web/src/app/globals.css`); skeletons, not spinners, for lists; sentence-case copy; optimistic updates with undo toasts for destructive or bulk actions; focus rings and keyboard reachability everywhere; truncation that never breaks layout; correct in light and dark, at 390px, 768px and 1440px.
- Before coding the UI, sketch the states (empty, loading, one item, many items, very long names, error, rate-limited) and design each one deliberately.

## Mock data and break-it testing for every phase

- **Scenario seed packs.** Add an opt-in internal seeder `devSeed.seedScenario({ workosUserId, scenario })` beside `devSeed.seed` in `packages/convex/devSeed.ts` (which seeds 27 cards today through `insertCompletedCards`). It reuses `seed`'s guard (`readIsDevDeployment()` or a local backend on the WorkOS emulator) and pages its writes so 1,000+ cards never exceed one mutation's limits. `scripts/store-assets/seed.ts` is a precedent for scripted seeding. Each phase adds the packs it needs:
  - Volume: 1,000+ cards across all 8 types, imported cards with old `createdAt`, trashed and archived mixes.
  - Ugly data: 300-character titles, emoji, RTL and CJK titles and tags, empty titles, duplicate URLs, tags differing only by case; URLs with unicode hosts or `www.`, links with no metadata or a broken image; huge PDFs, a video with no audio, images with and without EXIF.
  - Phase-specific: 0, 1 and 500 folders, a card in 50 folders; 2,000 tags; malformed and huge RSS feeds (fixtures served from a local file); articles with scripts or iframes and paywalled pages; expired and revoked share tokens; smart-folder queries that match nothing or everything.
- **Break the UI** with the `e2e` MCP against `bun run dev`, and fix every bug found before the PR: rapid double-clicks; bulk-selecting 300 cards; back and forward through URL state; reload mid-action; two tabs editing the same card; slow network; offline and reconnect; rate-limit responses; keyboard-only use; the 390px drawer; long text everywhere; dark mode.
- **Break the backend**: table-driven and fuzz-style tests over parsers and validators (query grammar, CSV and JSON importers, RSS and Atom, Readability fixtures, export CSV escaping); Convex tests for caps and limits (100-item bulk, 50 folders per card, 200-card free cap); concurrency and OCC cases (extend `packages/convex/occContention.test.ts`), ownership checks (another user's IDs), deleted or archived edge states, and idempotent retries; API, MCP and CLI calls with bad input, bad cursors and missing auth. Every bug found gets a regression test, then a fix.

## Release gate for every phase

1. Run the narrowest tests, then the repo checks: `bun run lint`, `bun run typecheck`, `bun run --cwd packages/convex test:unit` and `test:edge`, `bun run --cwd packages/ui test`, `bun run --cwd apps/web test`, and the relevant `packages/tests` e2e specs.
2. Seed the phase's scenario packs, then run the break-it pass on UI and backend; fix and add regression tests until clean.
3. Proof before the PR: record a video walkthrough of every new flow (happy path plus key edge cases) and screenshots of each state (empty, loading, populated, error; light and dark; 390px and 1440px). Save them in the session scratchpad, send them to the owner, and link or summarise them in the PR body. For API, MCP and CLI, include captured request and response or terminal output.
4. Open the PR. CI must be green and the PR mergeable. Merge, deploy (Files Worker first when touched), run any backfill (dry run, then pages), and smoke-test production. Only then start the next phase.

## Phases

Each phase is its own plan and PR.

| # | Plan | Items | Depends on |
|---|---|---|---|
| 1 | [Card detail quick wins](2026-10-12-roadmap-01-card-detail-quick-wins.md) | #3 Refresh details (was "Re-run AI"), #4 link author/date, #5 EXIF | — |
| 2 | [Sort, URL state and createdAt ordering](2026-10-12-roadmap-02-sort-url-state.md) | #1 | — |
| 3 | [Archive and bulk actions](2026-10-12-roadmap-03-archive-bulk-actions.md) | #16, #2, #11 | 2 |
| 4 | [Sidebar app shell and routed views](2026-10-12-roadmap-04-sidebar-app-shell.md) | foundation | 3 |
| 5 | [Folders (manual)](2026-10-12-roadmap-05-folders.md) | Tier 3 | 4 |
| 6 | [Tags sidebar and rename, merge, delete](2026-10-12-roadmap-06-tags-sidebar-management.md) | #8 | 4 |
| 7 | [Search qualifiers, `site:` and autocomplete](2026-10-12-roadmap-07-search-qualifiers.md) | #7 | 5, 6 |
| 8 | [Smart folders](2026-10-12-roadmap-08-smart-folders.md) | Tier 3 | 7 |
| 9 | [Keyboard shortcuts](2026-10-12-roadmap-09-keyboard-shortcuts.md) | #10 | 4 |
| 10 | [Shuffle sort](2026-10-12-roadmap-10-shuffle-sort.md) | #21 | 2 |
| 11 | [Export v2 (AI fields, HTML, CSV)](2026-10-12-roadmap-11-export-v2.md) | #9 | 5 |
| 12 | [New importers and folders from imports](2026-10-12-roadmap-12-importers.md) | #12 | 5 |
| 13 | [Stored text: documents, video transcripts, `get_card_content`](2026-10-12-roadmap-13-stored-text.md) | #14, #15, #22 | 7 (backfill first) |
| 14 | [Reader view](2026-10-12-roadmap-14-reader-view.md) | #13 | 13 |
| 15 | [Stats in Settings](2026-10-12-roadmap-15-stats.md) | #20 | 6 |
| 16 | [Rule engine](2026-10-12-roadmap-16-rule-engine.md) | Tier 3 | 5, 7 |
| 17 | [RSS feeds](2026-10-12-roadmap-17-rss-feeds.md) | Tier 3 | 5 |
| 18 | [Public share links](2026-10-12-roadmap-18-public-share-links.md) | Tier 3 | 5, 8 |
| 19 | [Hardening](2026-10-12-roadmap-19-hardening.md) | #22 | all |

Why this order: ship user-visible wins with zero schema risk first (1), then the ordering and URL foundation and the archive flag so every new index is built once (2–3), then the shell that folders, tags and shortcuts hang off (4), then organization (5–8), then independent polish (9–12), then text and reader (13–14), then stats and the automation and sharing features that depend on folders and the query planner (15–18), and finally hardening (19).

## Risks And Open Questions

- Index rebuilds: every new `cards` index backfills on deploy. Phases 2, 3, 5, 7 and 10 each add indexes; deploy them in low-traffic windows and watch Convex database I/O (`.agents/convex-costs.md`).
- Paginated cursors reset when a list path changes index. Native pagers (`apps/apple/Teak/Features/Library/CardPager.swift`, `apps/android/core/data/.../CardPager.kt`) must recover from an invalid cursor by restarting the page.
- The dev account is on the free plan, so the 1,000-card volume pack goes past the 200-card cap. Seeded cards bypass the quota check by inserting directly; the capped state is itself a scenario to check.
