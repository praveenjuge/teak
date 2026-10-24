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
