## Goal

Add a Stats section to Settings: totals by type, top sites, top tags, saves per month, an activity heatmap and storage use, computed in the background from a cached snapshot instead of live scans. Phase 15 of the [roadmap](2026-10-12-roadmap-00-roadmap.md).

## Depends on

- [Phase 6](2026-10-12-roadmap-06-tags-sidebar-management.md) (`userTagSummaries` for top tags). Top sites use `cards.urlHost` from [Phase 7](2026-10-12-roadmap-07-search-qualifiers.md), which ships earlier in the order.

## Success Criteria

- Settings shows Stats with: cards by type, archived and favorites counts, top 10 sites, top 10 tags, saves per month for the last 12 months, a 52-week activity heatmap, total storage and the five largest cards.
- Opening Settings never scans the library inline: it reads one snapshot row; a stale snapshot (older than 24 hours) or a manual Refresh (at most hourly) recomputes it in the background.
- Numbers match a direct count on the seeded volume pack.

## Context And Current Facts

- Settings sections render from `packages/ui/src/components/settings/SettingsContent.tsx` (for example `SecuritySection`, `ImportExportSection`); the web route is `apps/web/src/app/(app)/settings`.
- Active card counts already exist cheaply in `card/cardUsage.ts` (`getActiveCardCount`, sharded `userCardUsageShards`), which counts cards not in Trash.
- After Phase 6, `userTagSummaries` holds tag counts; reuse it for top tags rather than reading `cardSearchTags` again.
- File sizes live in `cards.fileMetadata.fileSize`; link media sizes are not stored, so storage covers uploaded files only.
- `cards.by_created` (`["userId", "createdAt"]`) supports a paged walk in date order for month buckets and the heatmap.
- No chart library is in the web or UI packages, and the UI bar forbids adding one: charts are CSS (bars and a grid of cells).

## Constraints And Non-goals

- `userStatsSnapshots { userId, computedAt, status, totals, byType, topSites, topTags, perMonth, heatmap, storage { bytes, largest[] } }` is per user: add it to `accountDeletionData.ts ancillaryPage`. Snapshots hold card IDs only in `largest[]`; a hard-deleted card simply disappears on the next recompute.
- `workflows/statsCompute.ts` pages through cards (bounded batches), accumulates in a reducer, and writes the snapshot once at the end; one run per user at a time.
- Refresh limited to once per hour per user (`shared/rateLimits.ts`).
- No Wrapped, no "On this day" (dropped). Web only; no API surface.

## Backend

- `stats/reducer.ts`: pure `accumulateStats(acc, cards)` and `finalizeStats(acc)` (top-N, month buckets in the user's week start, heatmap by day).
- `workflows/statsCompute.ts`: page `cards.by_created` for the user, 200 per batch, feed the reducer, merge top tags from `userTagSummaries`, write `userStatsSnapshots`.
- `stats/stats.ts`: `getStats` (session query returning the snapshot and `isStale`), `refreshStats` (mutation: rate limit, start the workflow if none running).

## Web

- `packages/ui/src/components/settings/StatsSection.tsx`: a compact grid of small panels; type totals as horizontal bars; months as a bar row; heatmap as a 7×52 grid of muted-to-primary cells with a tooltip per day; top sites and tags as ranked lists with counts; storage total plus largest cards linking to `?card=`.
- "Updated 3 hours ago · Refresh" in the section header.

## API / MCP / SDK / CLI

- None.

## Docs

- `features.mdx`: short "Stats" note under Settings or "Apps and access".
- Ship-month changelog: "See your library at a glance".

## UI states

- Empty: a new account shows "Stats appear after you save a few cards." with no charts.
- Loading: first visit with no snapshot shows panel skeletons while the workflow runs; later visits show the old snapshot with "Updating…".
- One item / many items: one card shows sensible bars; 1,000+ cards render the same layout.
- Very long names: long hosts and tags truncate in ranked lists with tooltips.
- Error: a failed compute keeps the last snapshot and shows "Couldn't update stats." with Retry.
- Rate-limited: Refresh disabled with "Available again in 40 minutes."
- UI bar: muted palette with one accent for bars and heatmap; numbers in tabular figures; no animation beyond the standard fade.

## Scenario seed packs

- Reuse the volume pack (1,000+ cards, all 8 types, imported dates across years) and `tags-2000`; add `stats-storage`: twenty large files with known sizes.

## Break-it checklist

- UI: click Refresh repeatedly; open Settings in two tabs during a compute; 390px layout of the heatmap (horizontal scroll inside the panel only); dark-mode contrast of heatmap cells; keyboard focus on heatmap cells shows the tooltip.
- Backend: compute on an empty account; compute during a bulk archive; account deletion mid-compute (stands down); cards with no `fileSize`; imported cards dated in the future; time-zone month boundaries.

## Tests

- `packages/convex/__tests__/stats/reducer.test.ts`: table tests for totals, top-N ties, month buckets and heatmap boundaries.
- `packages/convex/__tests__/workflows/statsCompute.test.ts`: paging across batches equals a single-pass reduce; one run per user.
- `packages/convex/__tests__/stats/stats.test.ts`: staleness, refresh rate limit.
- `packages/ui/src/components/settings/__tests__/StatsSection.test.tsx`: renders empty, loading and populated snapshots.

## Proof before the PR

- Video: open Settings on the volume pack, read each panel, Refresh, try again (rate-limited).
- Screenshots: empty, loading, populated, error; light and dark; 390px and 1440px.

## Release gate

1. Narrow tests above, then the repo checks and `packages/tests/src/web/composer-and-settings.e2e.ts`, `settings-layout-stability.e2e.ts`.
2. Seed the volume and storage packs, run the break-it pass, fix and add regression tests.
3. Proof bundle as above.
4. PR, green CI, merge, deploy Convex then web. No backfill (snapshots compute on first view). Smoke-test production: open Stats on a real account and confirm totals against the card count.

## Risks And Open Questions

- Compute cost on large vaults: bounded batches and the hourly limit cap it; watch database I/O after launch.
- Heatmap time zone: proposed to bucket by the browser's time zone passed to `refreshStats`.
