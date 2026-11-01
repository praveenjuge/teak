# Self-driving playbook

Last reviewed: 2026-11-01

Daily scheduled run: read PostHog (project 660923), fix what is broken or slow, check yesterday's fixes, and keep the agent guides true. `.agents/guides/analytics.md` has the event catalog.

The run's log lives only in the PostHog notebook "Teak self-driving log": read the last few entries first, and append today's there. This file holds what stays true from run to run; change it only when a lesson will matter again, never to record a day.

## Every run

- No `CONVEX_DEPLOY_KEY` in the routine environment: do not run `bun run dev`; rely on unit tests, typecheck and CI.
- Order: inbox (`inbox-reports-list`) → error tracking (`query-error-tracking-issues-list`, `-24h`, by users, then by `first_seen`) → product events → web vitals → surveys → Vercel/Cloudflare.
- Check the latest `Backend Deploy`, `Unit Tests` and `E2E` runs on `main` every run. Backend Deploy's typecheck covers test files, so a test-only type error blocks every backend deploy.
- Fail events (`card_create_failed`, `card_processing_failed`, `export_failed`, ...) only exist in the PostHog taxonomy once they have fired; "not found in taxonomy" means zero occurrences, not a typo.
- Before counting "users" on an error, check `$lib` and `distinct_id`: a crash loop on one device inflates it. `inbox-reports-list` returns an empty list when nothing is flagged.
- Never auto-merge changes touching schema, auth/WorkOS, billing/Polar, secrets/env, user-data deletion, release/version files or major dependency bumps.

## Mondays: keep the guides true

Once a week, after the health check, audit the agent guides and open one PR that deletes or fixes what drifted. Merge it yourself only when it changes guides and nothing else.

1. Run `bun --no-env-file test scripts/repo/agent-guide-paths.test.ts`. A failure names a guide that points at a moved or deleted file.
2. List the guides whose `Last reviewed:` date is more than 60 days old (`grep -r "^Last reviewed:" .agents`). Pick at most three, oldest first.
3. For each, check every command, file, table, env var and number against the code on `main`. Delete lines that are no longer true or that repeat a docs page or a code comment; fix the rest. Move anything a self-hoster or contributor would need into the docs page that `.agents/README.md` names for it. Set `Last reviewed:` to today.
4. Every fourth Monday, run `.agents/skills/maintain-verification-skill` against `.agents/skills/verify-teak` and fix the recipes that drifted.

## Useful queries

- Product health: `SELECT event, properties.card_type, properties.source, count() FROM events WHERE timestamp > now() - interval 24 hour AND event IN ('card_created','card_create_failed','card_processing_failed','card_processing_completed') GROUP BY 1,2,3`
- Stack frames: `JSONExtractArrayRaw(toString(properties.$exception_list))`.
- HogQL reserves `first`, `last` and `fn`: alias them (`firstseen`, `lastseen`).

## Tool tips

- GitHub `actions_list` output for workflow runs is huge: read the saved file with Python (`json.loads(t[t.index('{'):])`), or use `actions_get list_workflow_jobs`, then `get_job_logs` with `tail_lines` of about 140 to see the failing test names.
- `bun install --frozen-lockfile` takes about 20 seconds; then `bun test` works in `apps/core-worker`, except the three rendering tests that need a real Chrome.
