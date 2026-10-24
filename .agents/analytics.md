# Analytics and error reporting

Teak sends product analytics, error reports, web session replays, feedback and AI cost to one PostHog project. Read this before adding an event, a surface, or an env var.

## Project

- PostHog project **Teak** (id `660923`) in the **Teak** organization, US Cloud: <https://us.posthog.com/project/660923>
- Public project token: `phc_nMZjok7SyRwAJVbk34ifkYukb3vzhLBx89WQLju89yBn`. It is public (it ships in client bundles), but only production builds use it, so development, preview, CI and test builds send nothing.
- People are identified by the canonical Teak user id (`teak_…`): `getAuthUser._id` on web, the WorkOS `external_id` on Apple and Android, `userId` on the backend. Person properties: `email`, `plan` (`free` or `pro`), `signed_up_at`, and `locale` (the account's UI language, set by the web app).
- Test accounts (cohort "Internal / Test users", and email containing `e2e-`) are excluded by default in every insight.

## Surfaces

Split any insight by `$lib`.

| Surface | `$lib` | What it sends | Code |
| --- | --- | --- | --- |
| Web app | `web` | Pageviews, web vitals, exceptions, client events, masked replay, feedback survey | `apps/web/src/lib/posthog-client.ts`, `posthog-config.ts` |
| Web server | `teak-web-server` | Render, route and action errors | `apps/web/src/instrumentation.ts` |
| Convex backend | `teak-backend` | Server events, `$ai_generation`, non-retryable exceptions, cron failures. Events from mutations reach PostHog through the Files Worker | `packages/convex/telemetry/posthog.ts`, `telemetry/schedule.ts` |
| Files worker | `teak-files-worker` | Op failures, uncaught errors, non-retryable background (workflow, queue) failures, and card processing's `$ai_generation` and `card_processing_completed` | `apps/files-worker/src/telemetry.ts`, `src/workflows/telemetry.ts` |
| Browser extension | `teak-extension` | Errors, `extension_card_saved`, `extension_omnibox_used`, `signed_in` (background and popup only) | `apps/extension/lib/telemetry.ts` |
| Apple app | `posthog-ios` | Lifecycle events, identify, crashes (main app only; Share and Safari extensions send nothing) | `apps/apple/Teak/App/PostHogReporting.swift` |
| Android app | `posthog-android` | Lifecycle events, identify, crashes | `apps/android/.../TeakApplication.kt` |

## Event catalog

The typed catalog lives in `packages/convex/shared/analytics.ts`. Add new events there first. Keep properties low-cardinality and never include card content, URLs, file names, prompts or outputs. The web search lives in `?q=`; `posthog-config.ts` masks it in `$current_url`, referrers and replays, so keep search text out of any other URL parameter.

Client events (`captureEvent`):

- `card_create_submitted` {card_type, source, via}
- `search_performed` {zero_result, qualifiers?}: `qualifiers` lists the qualifier keys the search used (`text`, `tag`, `price`…), never their values
- `search_operator_used` {negation, or, groups}: sent with `search_performed` when the search used `-`, `OR` or parentheses. Each flag says whether that operator appeared (`groups` is a parenthesised group the operators' precedence needed)
- `similar_search_opened` {source}: "More like this" in a card's details
- `revisit_started` and `revisit_finished` {archived, kept, completed}: a Revisit deck opened, then closed or finished. The counts are cards, 0 to 20; `completed` is true when the deck reached its end screen
- `card_thumbnail_replaced` {source: `drop`, `paste` or `pick`} and `card_thumbnail_reset`, when someone replaces or resets a link's image in the card dialog
- `card_backlink_opened`: a card opened from another card's "Linked from" list in the card dialog
- `card_done_toggled` {done, category, source: `panel`}: a link marked read, watched, bought or done (or not) in the card dialog. `category` is its link category, or `none`
- `link_pdf_saved` {source: `panel`}: Save PDF made a document card from an arXiv link in the card dialog
- `file_upload_completed` {bucket, size_bucket} and `file_upload_failed` {bucket, size_bucket, error_class}
- `import_started`, `import_completed`, `import_failed` {error_class}
- `export_started`, `export_completed` (download), `export_failed` {error_class}
- `checkout_started`, `checkout_opened`
- `signed_in`, `extension_card_saved` {via}
- `extension_omnibox_used` {result: `card` or `search`}: Enter in the address bar's Teak mode opened a suggested card or the web search. The query text is never sent
- `locale_changed` {from, to}: the UI language changed in Settings → Language (codes such as `en`, `de`, `zh-Hans`)

Server events (`captureBackendEvent`):

- `user_signed_up` {source}, which sets `email`, `plan: free` and `signed_up_at`
- `card_created` and `card_create_failed` {card_type, source, error_class}. `source` is `web`, `apple` or `android` when the signed-in apps pass it to `cards:createCard` or `cards:finalizeUploadedCard`; `api` for public API uploads, `raycast` for public API text saves, `import` for imports; `unknown` for app versions that predate it
- `card_processing_completed` {card_type, duration_ms, ai_language}, sent by the Files Worker when a card-processing run finishes. `ai_language` is the language code AI wrote the tags and summary in (`en`, `ja`, `es`…), only when the run wrote them and the model named a valid language
- `card_processing_failed` {stage, error_class, card_type}
- `checkout_completed` (Polar `subscription.created`, sets `plan: pro`), `subscription_ended` (Polar `subscription.revoked`, sets `plan: free`), `checkout_failed` {error_class}
- `billing_portal_opened`
- `mcp_tool_called` {tool, outcome, status, duration_ms}
- `card_thumbnail_replaced` {source: `api`} and `card_thumbnail_reset`, when the public API (and so MCP, the SDK and the CLI) replaces or resets a link's image
- `card_done_toggled` {done, category, source: `api`}, when the public API (and so MCP, the SDK and the CLI) marks a link done or not
- `link_pdf_saved` {source: `api`}, when the public API (and so MCP, the SDK and the CLI) saves an arXiv link's PDF as a document card
- `email_save_toggled` {enabled}: Save by email turned on or off in Settings
- `email_received` {outcome}: one email from an account's owner reached Save by email. `outcome` is `saved`, `duplicate` (a redelivery), `empty`, `dropped_limit` (the free card limit), `dropped_rate` (over 60 an hour) or `deferred_rate` (the card creation limit; the sender retries). Mail Teak refuses at delivery never reaches Convex and has no event
- `email_attachment_saved` {kind, size_bucket} and `email_attachment_skipped` {reason: `format`, `size` or `limit`}: an emailed attachment made, or didn't make, its own card. An upload that fails in the Email Worker has no event: a transient failure fails the delivery so the sender retries, and a part the Files Worker refuses is skipped there, seen only in the Worker's `upload_refused` log count. `card_created` with `source: "email"` is sent for every card Save by email makes
- `$ai_generation` with `$ai_model`, `$ai_provider`, `$ai_input_tokens`, `$ai_output_tokens`, `$ai_latency` (seconds), `$ai_total_cost_usd`, `$ai_trace_id` (workflow or card id), `$ai_span_name`, `$ai_is_error`. Prompts and outputs are never sent.

Exceptions are `$exception` events built by `buildExceptionProperties` in `packages/convex/shared/posthog.ts` (raw frames, scrubbed with `scrubTelemetryValue`). Backend retryable errors (rate limits, validation retries) are not reported; workflow retries own them.

## Performance rules

- posthog-js never joins the web app's initial bundle. `instrumentation-client.ts` loads it with a dynamic `import()` when the page is idle (`requestIdleCallback`, 3 s timeout). A small queue holds early calls and early `error`/`unhandledrejection` events.
- The SDK, recorder and surveys load from the same-origin `/ingest` proxy (`next.config.ts` rewrites; `src/proxy.ts` lets `/ingest/` through without auth). CSP needs no third-party hosts.
- The feedback survey's tab sits on the right edge, lowered toward the bottom by `lowerFeedbackTab` (`posthog-config.ts`) so it clears an open card's Next button. Keep the survey's tab position on the right; the override only applies there.
- No click autocapture, heatmaps, dead clicks, console logs or network capture. Teak uses no feature flags, but `/flags` still loads after init because the feedback survey's targeting depends on it.
- Server-side capture (Convex, worker, extension, Next.js `onRequestError`) uses the dependency-free `createPostHogBatch` and sends one `/batch/` request per unit of work. Convex actions flush once at the end (`withBackendTelemetryScope`). Mutations can't fetch, so they queue each event in the workflow dispatch outbox (`queueBackendEvent` in `packages/convex/telemetry/schedule.ts`) and the Files Worker sends a flush's events in one `/batch/` request, unchanged (`$lib: teak-backend`). Convex queues nothing without `POSTHOG_PROJECT_TOKEN`. Delivery is best effort: Convex drops the row when it hands it over.
- Native SDKs flush in the background (`flushAt` 20, every 30 s) with screen views, replay and flag preloading off.

## Env vars

| Name | Where | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` | Vercel Production | Inlined only when `VERCEL_ENV=production` |
| `POSTHOG_PROJECT_TOKEN` | GitHub secret, Convex prod (set by Backend Deploy), worker `wrangler.jsonc` var | Also feeds the Apple archive and the extension release build |
| `WXT_POSTHOG_PROJECT_TOKEN` | Extension Release workflow | From `POSTHOG_PROJECT_TOKEN` |
| `POSTHOG_ANDROID_TOKEN` | Local Android release env or Gradle property | Release builds only |
| `POSTHOG_CLI_API_KEY`, `POSTHOG_CLI_PROJECT_ID` | Vercel Production, GitHub secrets, local Android env | Personal API key with error-tracking write; uploads web source maps, Apple dSYMs, Android R8 mappings. Uploads are skipped when unset |
| `POSTHOG_CLI_HOST` | Workflows | `https://us.posthog.com` |
| `POSTHOG_PERSON_DELETION_API_KEY` | Convex prod (dashboard) | Personal API key with `person:write`. Account deletion's last stage (`packages/convex/accountDeletion/analytics.ts`) deletes the owner's person, events and recordings with it. Required wherever `POSTHOG_PROJECT_TOKEN` is set; without it, deletions retry until it is |

## Dashboards, alerts and survey

Set up through the PostHog MCP connector on 2026-10-12.

| Item | ID | Link |
| --- | --- | --- |
| Dashboard: Growth & activation (project home) | 2201877 | <https://us.posthog.com/project/660923/dashboard/2201877> |
| Dashboard: Cards & AI pipeline | 2201878 | <https://us.posthog.com/project/660923/dashboard/2201878> |
| Dashboard: Revenue | 2201879 | <https://us.posthog.com/project/660923/dashboard/2201879> |
| Dashboard: Reliability | 2201880 | <https://us.posthog.com/project/660923/dashboard/2201880> |
| Dashboard: Web traffic (PostHog starter) | 2201829 | <https://us.posthog.com/project/660923/dashboard/2201829> |
| Alert: New error issue (hourly, email) | `01a13143-d6ce-0000-799f-c53dc3d8b386` | Backed by insight `QjW9RAVi` |
| Alert: Checkout failed (hourly, email) | `01a13143-dcde-0000-369c-7a2ab5474e66` | Backed by insight `xkZQ2tkH` |
| Survey: Send feedback (web widget tab, launched) | `01a13144-47ae-0000-cc6e-2e48a7b78868` | <https://us.posthog.com/project/660923/surveys/01a13144-47ae-0000-cc6e-2e48a7b78868> |
| Action: Card created (any surface) | 383445 | |
| Cohorts: Pro users, E2E accounts, Activated (5+ cards in 7 days) | 632412, 632413, 632414 | |
| Annotation: Switched from Sentry | 486726 | 2026-10-12 |

Error-tracking alerts in PostHog deliver only to Slack, webhooks and similar integrations, and none is connected. The new-issue alert is therefore an hourly insight alert on a SQL count of issues first seen in the last hour, which emails the subscriber.

Project settings: timezone Asia/Kolkata; autocapture, heatmaps, dead clicks, console logs and network capture off; web vitals and exception autocapture on; replay records 10% of sessions plus any session with an `$exception` (minimum 2 s, all text and inputs masked, media blocked, `app.teakvault.com` only); surveys on.
