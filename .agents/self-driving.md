# Self-driving playbook and log

Daily scheduled run: read PostHog (project 660923), fix what is broken or slow, check yesterday's fixes. Notebook: "Teak self-driving log" in PostHog. See `.agents/analytics.md` for the event catalog.

## Playbook

- No `CONVEX_DEPLOY_KEY` in the routine environment: do not run `bun run dev`; rely on unit tests, typecheck and CI.
- Order: inbox (`inbox-reports-list`) → error tracking (`query-error-tracking-issues-list`, `-24h`, by users, then by `first_seen`) → product events → web vitals → surveys → Vercel/Cloudflare.
- Fail events (`card_create_failed`, `card_processing_failed`, `export_failed`, ...) only exist in the PostHog taxonomy once they have fired; "not found in taxonomy" means zero occurrences, not a typo.
- Never auto-merge changes touching schema, auth/WorkOS, billing/Polar, secrets/env, user-data deletion, release/version files or major dependency bumps.

## Useful queries

- Product health: `SELECT event, properties.card_type, properties.source, count() FROM events WHERE timestamp > now() - interval 24 hour AND event IN ('card_created','card_create_failed','card_processing_failed','card_processing_completed') GROUP BY 1,2,3`

## Log

### 2026-10-12
- First run. Telemetry went live with #633/#635 the same day; PostHog had 1 `card_created` (source `unknown`) and 1 `card_processing_completed`, no exceptions, empty inbox. Nothing fixed.
- Check tomorrow: first real error-tracking and `card_create_failed` data; whether `source` is populated for web/apple/android after #635.

### 2026-10-14
- Inbox empty. Error tracking (24h): `NoClassDefFoundError` (`android.window.SplashScreenView`, 8 events) and Convex `ClientException$InternalException` (`channel closed`, 3 events), both from Android 1.0.86 on Android 11 (API 30) within 10 minutes on 2026-10-13, apparently one test device (events share a `distinct_id`; "4 users" is mostly anonymous ids). Not fixed: no reproduction, so root cause (core-splashscreen 1.2.0 on API 30) is unconfirmed; raised as a `needs-praveen` issue.
- Product health: 13 `card_created` events, 17 `card_processing_completed`, zero failures. `source` is populated for web, android and raycast; still `unknown` on a few text/video cards (older app versions).
- Tip: `inbox-reports-list` returns an empty list when nothing is flagged; check `$lib` and `distinct_id` on error events before counting "users", since crash loops on one device inflate it.
- Check tomorrow: whether the Android crash recurs from other devices; first non-zero failure events.

### 2026-10-15
- Inbox empty. No Android crash recurrence in 24h (the 2026-10-13 crash looks like a one-device event). One burst of 3 `$exception` events from `teak-files-worker` (`get: We encountered an internal error. Please try again. (10001)`, anonymous, within 300 ms): Cloudflare R2 internal error on `get`, transient and single-burst, not fixed. Watch for repeats before adding a retry.
- Product health: 14 `card_created`, 18 `card_processing_completed`, zero failure events. `source` still `unknown` on some image/text/link cards (older app versions).
- Nothing merged earlier, so no fixes to measure. No PRs this run besides this log.
- Check tomorrow: recurrence of R2 10001 errors (if more than one burst, add a bounded retry in the files worker); first non-zero failure events.

### 2026-10-16
- Inbox empty. Product health: 25 `card_created`, 25 `card_processing_completed`, zero failure events.
- **Backend Deploy failed on main** (#712, run 38792427700): `tsc --noEmit` error in `accountDeletionStorage.test.ts(444)` (test-only; `runMutation` stub typed `never`). Blocks every backend deploy until fixed; prod backend lacked #712. Fixed by a test typing PR. Lesson: the Backend Deploy typecheck covers test files; check `list_workflow_runs` for Backend Deploy on main every run.
- Files worker `$exception`s: Vectorize `returnMetadata: expected value` (10 events, 17:31–17:32 IST on 10-15) predates the fix in #711 (19:37 IST), none after. `VECTOR_UPSERT_ERROR 40041 Too Many Requests` (4, backfill burst) — transient, watch for repeats; consider backoff in the backfill if it recurs. Two web `searchCardsPaginated` Server Errors likely the same Vectorize issue.
- Check tomorrow: Backend Deploy green on main; zero `VECTOR_QUERY_ERROR`; any more 40041.

### 2026-10-17
- Inbox empty. Backend Deploy green on main (latest run 38955390547). Product health (24h): 17 `card_created`, 192 `card_processing_completed`, zero failure events.
- Exceptions: 19 `VECTOR_UPSERT_ERROR 40041` from one burst at 07:57 UTC on 10-16, before the batching/retry fix merged at 09:31 UTC (`fix(convex): batch card embeds`, `vectors.ts` retry); none since. Check as measured: fix held. One transient Durable Object "Connection closed" in the files worker; watch for repeats.
- Tip: `last` is a reserved word in HogQL; alias it `lastseen`. The GitHub `actions_list` output is huge; read the saved file with python.
- Nothing fixed, nothing merged. Check tomorrow: zero 40041 after 10-16 09:31 UTC; DO "Connection closed" recurrence.

### 2026-10-18
- Inbox empty. Backend Deploy green on main (latest run 39058206602). Product health (24h): 10 `card_created`, 131 `card_processing_completed`, zero failure events.
- Exceptions: 6 `malformed_workers_ai_response` from the files worker, 16:37–16:57 UTC on 10-17, before #747 (Gemma thinking off for image metadata, deployed 17:20 UTC); none since, so the fix held. No 40041 or DO "Connection closed" repeats. Both earlier watch items cleared.
- Nothing fixed. Check tomorrow: zero `malformed_workers_ai_response` after 10-17 17:20 UTC; first non-zero failure events.

### 2026-10-20
- Inbox empty. Backend Deploy green on main (latest run 39304085856). Product health (24h): 12 `card_created` (web, android, raycast, email), 23 `card_processing_completed`, 1 `card_processing_failed` (`categorize`, `workflow_failed`, one card), no `card_create_failed`. `source` is populated everywhere except processing events (they carry no `source` by design).
- Exceptions: 2 files-worker `NonRetryableError convex_rpc_refused:...:401` (`adminUsage:replaceDailyUsage`, `workflowDispatch:listStale`) at 12:15-12:46 IST on 10-19, during the Worker rename/dev-split deploys (#767-#769); none since. Watch for repeats; if they recur, investigate the derived secret, endpoint, deployment target and request timing (secret drift between worker and Convex is one possible cause). One web `ResizeObserver loop` (benign). `malformed_workers_ai_response` stayed at zero after #747: fix held.
- Nothing fixed, nothing merged earlier to measure. Sentry/Vercel/Cloudflare connectors were not queried this run (time-boxed to PostHog and GitHub).
- Check tomorrow: recurrence of `convex_rpc_refused` 401s; `card_processing_failed` at `categorize`; Backend Deploy green.

### 2026-10-21
- Inbox empty. **Unit Tests failed on main** for #788 (run 39464007517): `signed worker file urls > mints identical urls for repeated signing within one window` in `packages/convex/__tests__/storage/r2.test.ts`. The test signed with `buildSignedWorkerFileUrl`'s default expiry, which moves every second, so it flaked whenever the clock ticked between two calls. Fixed by signing with `bucketedSignatureExpiry` (what `getR2Url` uses). Lesson: check Unit Tests on main, not just Backend Deploy.
- Product health (24h): 6 `card_created` (android), 6 `card_processing_completed`, zero failure events. Exceptions: 3 Android crashes (`SplashScreenView` NoClassDefFoundError, `channel closed`) from one OnePlus 8 Pro on API 30, app 1.0.88: same device as before; #785 fixes it but is unreleased (store release is Praveen's call). No files-worker `convex_rpc_refused` repeats.
- Sentry, Vercel, Cloudflare connectors not queried this run.
- Check tomorrow: Unit Tests green on main; Android crash from versions after the next release.

### 2026-10-22
- Inbox empty. Unit Tests and Backend Deploy green on main (latest runs 39523078040, 39523078188). Product health (24h): 2 `card_created` (link; raycast, unknown), 2 `card_processing_completed`, zero failure events. Low traffic.
- One extension `$exception`: `chrome.storage.local.setAccessLevel is not a function` (TypeError, 10-21 07:30 IST, single event). Watch for repeats; a browser without that API (Firefox or old Chrome) is the likely cause.
- Sentry, Vercel, Cloudflare connectors not queried this run. Nothing fixed.
- Check tomorrow: recurrence of the `setAccessLevel` TypeError; Unit Tests and Backend Deploy green on main.

### 2026-10-23
- Inbox empty. Unit Tests and Backend Deploy green on main (runs 39819058721, 39819058500). Product health (24h): zero `card_created`, zero processing events, zero failure events. Only card events were queried (not pageviews or other activity); nothing to measure.
- One backend `$exception`: `workflow_dispatch_stalled` (watchdog cron, 10-22 18:05 IST, single event). Properties: `stalled_pending` 0, `unreconciled_sent` 1, so one sent row the Files Worker's reconcile hadn't checked; the watchdog only kicks `workflowDispatch.flush` for `stalled_pending > 0`, so nothing healed it automatically. Watch for repeats; if it recurs, investigate the reconcile path.
- Tip: `actions_list` output for workflow runs is huge; parse the saved file with python (`json.loads(t[t.index('{'):])`). Sentry, Vercel, Cloudflare connectors not queried this run.
- Nothing fixed. Check tomorrow: recurrence of `workflow_dispatch_stalled`; first card traffic.

### 2026-10-24
- Inbox empty. Unit Tests and Backend Deploy green on main (runs 40006471429, 40006471445). Product health (24h): 3 `card_created` (web video/text, apple image), 3 `card_processing_completed`, zero failure events.
- Exceptions: 3 Android `channel closed` from the same API 30 device as before (fix #785 unreleased). One files-worker `Durable Object storage is no longer accessible.` (10-23 11:34 IST, single event; a Cloudflare DO reset). Watch for repeats before adding handling. `workflow_dispatch_stalled` and `setAccessLevel` did not recur.
- Sentry, Vercel, Cloudflare connectors not queried this run. Nothing fixed; no PostHog improvement shipped (time-boxed).
- Check tomorrow: DO "no longer accessible" recurrence; Unit Tests and Backend Deploy green on main.

### 2026-10-25
- Inbox empty. Unit Tests and Backend Deploy green on main (runs 40120391822, 40120391799). Product health (24h): 9 `card_created` (apple, raycast, web), ~206 `card_processing_completed` (reprocessing from #841), 1 `card_processing_failed` (link), no other failure events.
- New files-worker exceptions: (1) 12 × `TypeError: Cannot read properties of null (reading 'tagName')` from `extractArticle`: Readability walks past the document when a page's content sits outside `<body>` (linkedom keeps it beside an empty body). Reproduced, fixed by moving that content into the body (`moveStrandedIntoBody`). (2) 8 × `Could not load style` from `captureHtmlScreenshot`: `addStyleTag` refused by a page's CSP; the cleanup is now best effort. Both in #844; the test covers the article fix only (no test drives the CSP refusal). Follow-up keeps reading order for content before `<body>`.
- Tip: stack frames: `JSONExtractArrayRaw(toString(properties.$exception_list))`; `fn` is reserved in HogQL. `bun install --frozen-lockfile` takes ~20 s, then `bun test` works in `apps/files-worker` (the 3 real-Chrome rendering tests fail without Chrome here).
- Sentry, Vercel, Cloudflare connectors not queried; no PostHog improvement shipped (time-boxed).
- Check tomorrow: zero `tagName` and `Could not load style` exceptions after the PR deploys; `card_processing_failed` on links.

### 2026-10-26
- Inbox empty. Unit Tests and Backend Deploy green on main (runs 40206791004, 40206790994). Product health (24h): zero `card_created`, zero processing events, zero failure events. Low traffic, nothing to measure.
- One files-worker `$exception`: `ai_usage_sql_failed:500` (10-26 03:46 IST, single event; the usage write to Convex). Watch for repeats. Zero `tagName` and `Could not load style` exceptions after #844: fix held.
- Sentry, Vercel, Cloudflare connectors not queried; no PostHog improvement shipped (time-boxed). Nothing fixed.
- Check tomorrow: recurrence of `ai_usage_sql_failed`; first card traffic.

### 2026-10-27
- Inbox empty. Unit Tests and Backend Deploy green on main (runs 40385954544, 40385954636). Product health (24h): 3 `card_created` (android text/image/audio), 4 `card_processing_completed`, zero failure events.
- Exceptions: Android 1.0.91 on the same OnePlus 8 Pro (API 30) now crashes with `NoSuchFieldError: Configuration.fontWeightAdjustment` (2 events, 10-26 10:35 IST; the field is API 31+, so something compiled against a newer SDK reads it unguarded; cause not confirmed, no fix) plus 2 `channel closed`. Same single device as the earlier splash crash, which Praveen closed as not planned (#657). Two web `[tiptap error]: The editor view is not available` (possibly a mount race, 2 events), one files-worker DO "Connection closed" (single event). `ai_usage_sql_failed` did not recur.
- Sentry, Vercel, Cloudflare connectors not queried; no PostHog improvement shipped (time-boxed). Nothing fixed.
- Check tomorrow: recurrence of the tiptap error (if it grows, guard editor access until mounted); Android `fontWeightAdjustment` from a second device.

### 2026-10-28
- Inbox empty. Backend Deploy and Unit Tests green on main at 05a2e22 (runs 40565515537, 40565515794); the Unit Tests run on 4d7358a failed at 10-27 18:28 UTC and the next commit's run passed. Product health (24h): zero `card_created`, zero processing, zero failure events. Zero `$exception` events. Traffic was Apple app lifecycle (27 `Application Opened`), 16 pageviews, 4 `search_performed`, one Revisit and one reader open.
- Tip: `first` is also reserved in HogQL (alias `firstseen`).
- Sentry, Vercel, Cloudflare connectors not queried; no PostHog improvement shipped (time-boxed). Nothing fixed.
- Check tomorrow: recurrence of the tiptap error and Android `fontWeightAdjustment`; first card traffic.

### 2026-10-29
- Inbox empty. Backend Deploy and Unit Tests green on main at b482340 (runs 40649222566, 40649222597). Product health (24h): 1 `card_created` (apple), 1 `card_processing_completed`, zero failure events, no active error-tracking issues.
- The scheduled **E2E run failed on main** (run 40674012013, 10-28 10:40 UTC): chromium 9 of 130 tests across 7 files (settings-navigation, sidebar-navigation: keyboard shortcut `g s` stayed on `/`, combobox not found, Next.js dev overlay intercepting clicks on the Trash link) plus the Apple iPhone flows job; webkit and docs passed. The suite runs against the dev server, whose overlay and slow compile could explain it, but nothing was reproduced here, so no fix. Cause unknown: #876 (`feat(web): simplify the sidebar and page headers`, merged 10-27) changed the sidebar and these specs the day before, so it is a suspect as well as dev-server flake. Check whether the next scheduled E2E repeats the same tests before touching them.
- Tip: `actions_list` for runs is huge; `actions_get list_workflow_jobs` then `get_job_logs` with `tail_lines` ~140 shows the failing test names.
- Sentry, Vercel, Cloudflare connectors not queried; no PostHog improvement shipped (time-boxed).
- Check tomorrow: next scheduled E2E on the same tests; first card traffic.

### 2026-10-30
- Inbox empty. Backend Deploy and Unit Tests green on main at 3041a1a (runs 40873761618, 40873761480). Product health (24h): 42 `card_created` (api, raycast, web), matching `card_processing_completed`, zero failure events. Vercel production runtime errors: none. Web vitals: 2 events, nothing to judge.
- Exceptions: 4 Android `channel closed` (same single API 30 device), one files-worker `TargetCloseError` (Puppeteer page closed during a screenshot, single event; watch for repeats).
- **E2E failed on main again** (run 40861689320): 6 of 130 chromium tests in two files that also failed on 10-28 (settings-navigation, sidebar-navigation; 9 tests in 7 files then); Apple iPhone flows failed again. Repeated, so raised as #892 (`needs-praveen`) with a recommendation to run those two specs locally; not reproduced yet. The E2E suite uses a local backend and needs no deploy key (`bun run --cwd packages/tests e2e src/web/settings-navigation.e2e.ts`), so try it next run (needs Chromium and `bun install`).
- Sentry not queried (Teak moved to PostHog); Cloudflare not queried. No PostHog improvement shipped (time-boxed).
- Check tomorrow: next scheduled E2E (same files?); `TargetCloseError` recurrence.
