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
