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
