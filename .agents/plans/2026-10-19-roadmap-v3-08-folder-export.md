## Goal

Export one folder from its sidebar menu as the same ZIP a full export makes. It gets its own looser limit, so it doesn't use up the weekly full export. Phase 8 of the [roadmap v3](2026-10-19-roadmap-v3-00-roadmap.md).

## Depends on

- Nothing.

## Success Criteria

- **Starting it:** every folder's sidebar "⋯" menu, manual or smart, gets "Export folder", between Color and the separator before Delete. Choosing it starts an export of the cards that folder shows.
- **Progress:** a toast reads "Exporting Design · 40 of 120". When the export is ready, it becomes "Design is ready" with a "Download" action. Download starts the ZIP immediately, named `teak-design-2026-10-19.zip`.
- **If you leave:** the export continues. When the folder menu is opened again while the export is ready, "Export folder" turns into "Download export (ready)" until the artifact expires.
- **The ZIP** has the full-export layout: `manifest.json`, `cards.json`, `cards.csv`, `bookmarks.html` and `files/`. `manifest.json` adds `scope: { kind: "folder", folderId, folderName, folderKind, query? }`.
- **Limits:**
  - up to 1,000 cards per folder export, and 5 folder exports per rolling 24 hours;
  - the 7-day full-export rule is untouched: a folder export never sets `quotaCountedAt`;
  - one export of any kind runs at a time.
- **Settings → Export** still shows the latest full export only.
- **Not in this phase:** API, MCP, SDK and CLI. The owner chose the folder menu only.

## Context And Current Facts

- **Backend** (`packages/convex/dataExport.ts`):
  - `startExportJob` (lines 195–230) refuses when a job is active (`already_active`) or when `isWithinQuota(lastSuccessfulAt)` fails (`quota_exceeded`). It then inserts `exportJobs` and calls `queueExportWorkflow`.
  - `findLastSuccessfulAt` (lines 161–172) reads `quotaCountedAt` from recent jobs (`getRecentJobs`, lines 144–153, `by_user_created`).
  - `readLatestExport` (line 180) feeds `getLatestExport`, which Settings uses.
  - `getExportDownloadUrl` (line 318) is a session action that returns a 15-minute URL.
  - `recordSnapshotPage` (lines 391–444) pages every card of the user with `by_created` and keeps `isActiveCard` cards as `exportJobItems`. This is the filter point.
  - `completeExport` (line 520) and `getExportFolderNames` (line 502).
- **Job shape:** `exportJobValidator` (`schema.ts:344–363`) has userId, status, workflow, artifact, counts, stage, failureClass, timestamps and `quotaCountedAt`. There are no scope fields.
- **Constants** (`export/constants.ts`):
  - `MAX_EXPORT_CARDS = 10_000`, `MAX_EXPORT_BYTES = 5 GiB`;
  - 7-day retention and quota window;
  - `DOWNLOAD_URL_TTL_SECONDS = 15 * 60`;
  - `EXPORT_FAILURE_CLASS.CAP_EXCEEDED`.
- **Manifest:** `export/serialize.ts` `ExportManifest` and `buildManifest` (lines 223–258) carry versions, the app name, dates and counts.
- **Files Worker:** the workflow is `apps/files-worker/src/workflows/export.ts`: mark running, snapshot pages, build archive, complete.
- **Folder card reads:** `card/listQuery.ts:259–268` uses `folderCards` `by_folderId_and_isDeleted_and_cardCreatedAt` (and the archived variant). Phase 3 adds `…_cardSavedAt` twins.
- **Smart folder search:** smart folders resolve through `card/searchPlanner.ts` `expandFolderSearch` and `getCards`.
- **Folder menu:** `packages/ui/src/components/sidebar/SidebarFolders.tsx:318–372` has Rename…, Edit search… (smart only), the Color submenu, a separator, and Delete.
- **Settings:** the export UI is `packages/ui/src/components/settings/ExportPanel.tsx`, with `hooks/useSettingsController.ts`.
- **Public surfaces:** `POST /v1/exports` and `GET /v1/exports/latest` exist. MCP is deliberately excluded (`scripts/public-parity.ts`, `NO_AGENT_EXPORTS`).

## Constraints And Non-goals

- **Same workflow, same ZIP code.** Only the snapshot step's card source and the manifest differ.
- **Which cards:** the export contains the cards the folder page shows when opened. That is live, not trashed, not archived and not hidden: the default view. Smart folders use their saved query.
- **Limits:**
  - **Card cap:** `MAX_FOLDER_EXPORT_CARDS = 1_000`. A folder over the cap fails with `cap_exceeded` and the message "This folder has more than 1,000 cards. Export everything from Settings instead."
  - **Rate:** a new rate-limit entry, `folderExports` (fixed window, 5 per day per user), spent when a folder export starts. Over the limit: "You can export 5 folders a day. Try again in 6 hours." (the remaining time comes from the limiter).
- **Analytics:** `folder_export_started` and `folder_export_downloaded { cards, folderKind }`, added to `shared/analytics.ts` first.

## Backend

- **`schema.ts` `exportJobValidator`:**
  - `scope: v.optional(v.object({ kind: v.literal("folder"), folderId: v.id("folders"), folderName: v.string(), folderKind: v.union(v.literal("manual"), v.literal("smart")), query: v.optional(v.string()) }))`.
  - No new index. Recent-job reads already scan by user.
- **`shared/rateLimits.ts`:** `folderExports: { kind: "fixed window", rate: 5, period: DAY }`. Add `DAY` to the import, or use `24 * HOUR`.
- **`dataExport.ts`:**
  - **`startFolderExport({ folderId })`** (session mutation):
    1. Owner-check the folder; reject it while it is being deleted.
    2. Refuse when any export is active (`already_active`).
    3. Spend `folderExports`. Over the limit, return `{ started: false, reason: "folder_quota_exceeded", retryAfterMs }`.
    4. Insert the job with `scope` and queue the workflow.
  - **`findLastSuccessfulAt` and `readLatestExport`** skip jobs with a `scope`, so folder exports never touch the weekly quota or Settings.
  - **New `getLatestFolderExport({ folderId })`** (session query): the newest folder-scoped job for that folder, as a `summarizeJob` shape. The menu and toast use it.
  - **`recordSnapshotPage`** branches on `job.scope`:
    - **manual folder:** pages `folderCards` for the folder (live rows, not archived), loads each card, and keeps those that are `isActiveCard` and not hidden;
    - **smart folder:** pages the folder's saved query through the same resolver the folder page uses (`expandFolderSearch` + `resolveSearch`, default view), with the scan budget.
    - Both stop and fail with `cap_exceeded` past 1,000.
  - **`completeExport`:** never sets `quotaCountedAt` for scoped jobs.
- **`export/serialize.ts`:** `ExportManifest.scope?` and `buildManifest({ …, scope })`. `EXPORT_VERSION` stays 1, since readers ignore the new key.
- **Files Worker** (`workflows/export.ts`): pass `scope` into `buildManifest`. Name the artifact `teak-<slug>-<date>.zip` for folder scopes, where the slug is the lowercase folder name with non-alphanumerics turned into `-`, at most 40 characters, and "folder" when empty (CJK, emoji).
- **Account deletion:** no new table. Export jobs are already covered.

## Web

- **`SidebarFolders.tsx`:**
  - A new menu item, "Export folder" (`lucide-react` `Download` icon), after the Color submenu.
  - While `getLatestFolderExport(folder._id)` is running, the item reads "Exporting…" and is disabled.
  - When it's ready and not expired, the item reads "Download export" with a small "Ready" badge.
- **New `hooks/useFolderExport.ts`:**
  - `start(folder)` calls `startFolderExport` and opens a persistent loading toast, "Exporting {name} · {processed} of {total}", fed by the job summary.
  - On `ready`: "{name} is ready" with a Download action. Download calls `getExportDownloadUrl(jobId)` and starts the download with an anchor and `download` attribute.
  - On failure, the toast says why:
    - "This folder has more than 1,000 cards. Export everything from Settings instead.";
    - "Another export is running. Try again when it finishes.";
    - the daily-limit message;
    - "Export failed. Try again." for anything else.
- **Settings → Export:** unchanged. It now ignores folder jobs, through `readLatestExport`.

## API / MCP / SDK / CLI

- **None in this phase.** `scripts/public-parity.ts` is unchanged.
- **API side effect:** `GET /v1/exports/latest` (`publicApiExports.ts`) uses `readLatestExport`, so it also keeps returning full exports only. Add a test for that.

## Docs

- `(data)/export.mdx`: an "Export one folder" section covering where it is, what's included (what the folder shows), the 1,000-card and 5-a-day limits, the 7-day download window, and that it doesn't affect the weekly full export.
- `features.mdx`, under folders: one line.
- The month's changelog: "Export a single folder".

## UI states

- **Empty folder:** the export runs and gives a ZIP with 0 cards. The toast reads "Design is ready · 0 cards".
- **One card / 1,000 cards:** progress counts up. At 1,001 cards it fails with the cap message.
- **Very long or emoji folder names:** the toast truncates the name at 32 characters with an ellipsis, and the file name falls back to "folder".
- **Rate-limited:** the daily-limit toast, with the wait from the limiter.
- **Another export running:** the item is disabled with the tooltip "Another export is running".
- **Expired:** after 7 days the menu shows "Export folder" again.
- **Mobile sidebar** (390px): the menu opens below (`side="bottom"`), as today.

## Scenario seed packs

- **`folder-export`:**
  - a manual folder with 120 mixed cards: files, some archived, two hidden, one trashed;
  - a manual folder with 1,001 link cards;
  - an empty folder;
  - a smart folder `type:image #inspo`;
  - a folder named with emoji and CJK;
  - a folder with a 300-character name.

## Break-it checklist

- Export twice quickly: one job, and the second click is disabled.
- Run a full export in Settings, then export a folder: refused. The reverse is refused too.
- 6 folder exports in a day: the 6th is refused, with the time to wait.
- Delete the folder while it's exporting: the job finishes from its snapshot, or fails cleanly if the folder was gone before the snapshot.
- Move cards in and out of the folder mid-export: the snapshot is fixed at start.
- Download after 15 minutes: a fresh URL each click.
- After a folder export, Settings → Export still shows the last full export, and the weekly quota is unchanged.
- `GET /v1/exports/latest` ignores folder jobs.
- Another user's `folderId`: rejected.

## Tests

- `packages/convex/__tests__/dataExport.test.ts`:
  - the folder snapshot excludes archived, hidden and trashed cards;
  - the smart folder query is applied;
  - the cap;
  - the daily limit;
  - the quota is untouched;
  - `readLatestExport` and `GET /v1/exports/latest` ignore scoped jobs;
  - owner checks.
- `packages/convex/__tests__/export/serialize.test.ts`: the manifest `scope`.
- `apps/files-worker/src/workflows/export.test.ts`: the scoped artifact name and manifest.
- `packages/ui/src/components/sidebar/__tests__/SidebarFolders.test.tsx`: the menu item states.
- e2e: `packages/tests/src/web/folder-export.e2e.ts` (new). Export a 5-card folder, download it, unzip, and check that `cards.json` has the 5 cards and `manifest.json` has the scope.

## Proof before the PR

- **Video 1:** sidebar ⋯ → Export folder, the progress toast, Download, then opening the ZIP and showing `manifest.json`.
- **Video 2:** the 1,001-card folder fails with the cap message, then the daily limit.
- **Screenshots:** the menu (idle, exporting, ready) and every toast, in light and dark at 390px and 1440px.

## Release gate

1. Run the narrow tests, the repo checks and the e2e spec.
2. Seed `folder-export`, run the break-it pass, and fix and add regression tests until it is clean.
3. Send the proof bundle to the owner.
4. Merge. Deploy the Files Worker first, then Convex and web. Smoke-test a small folder export on production.

## Risks And Open Questions

- **Open decision (default: the export matches what the folder shows: no archived or hidden cards).** A full export includes archived cards. For a folder, matching the view is less surprising.
- **Open decision (default: 1,000 cards and 5 a day).** "A few per day" and "≤1,000" came from the owner's choice of a separate, looser limit.
- **Open decision (default: one export of any kind at a time).** Allowing a folder export beside a full export would need the active-job check split by scope.
- **Smart folder snapshots with free-text terms** use the full-text index and its 4,096-row scan budget. A very broad smart folder may fail with "too broad" before it reaches 1,000 cards. That surfaces as "Export failed. Try again.", so map it to a clearer message.
