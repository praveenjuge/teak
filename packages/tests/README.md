# Teak E2E tests

Playwright journeys across Teak's web app, REST API, CLI and MCP server, run against this checkout's own local E2E stack (`src/stack/`). It never touches the shared cloud dev deployment that `bun run dev` uses:

- the official WorkOS emulator ([`@workos/emulate`](https://www.npmjs.com/package/@workos/emulate)), standing in for hosted AuthKit,
- a local Convex backend (API and webhooks on the next port),
- the web app.

It needs no secrets. Every WorkOS value is a test-only constant in `src/stack/config.ts`, and the emulator keeps all of it in memory. The main checkout uses web 3000, Convex 3210/3211 and the emulator 4100/4101; each linked worktree uses its own ports, so the suite runs in any worktree.

## Run it

From the repo root, with this checkout's stack stopped (`bun run dev --stop`):

```bash
bun install
(cd packages/tests && bunx playwright install chromium firefox webkit)   # once
bun run --cwd packages/tests e2e
```

`e2e` runs `bun run setup --target e2e`, starts the stack, runs the journey and browser-matrix projects, and stops everything. The `web` project is not in the gating run yet; run it with `bun run --cwd packages/tests e2e --project=web`. Pass Playwright arguments to narrow it, for example `bun run --cwd packages/tests e2e --project=journey-api`.

To iterate, keep the stack up in one terminal and run Playwright in another:

```bash
bun run --cwd packages/tests e2e:stack
cd packages/tests && bunx playwright test --project=web
```

A running stack records its URLs in `.agents/.state/stack.json`, which the suite reads, and logs to `.agents/.state/stack.log`.

The `E2E` workflow (`.github/workflows/e2e.yml`) runs the same command daily and on demand (not on pull requests or pushes), and uploads the report, traces and stack log when it fails. An on-demand run takes Playwright arguments, for example `gh workflow run e2e.yml -f playwright_args='--project=web'`.

## How the stack is wired

`bun run setup --target e2e` points `packages/convex/.env.local` at a local backend (taking it over from the dev deployment; the next `bun run dev` selects that again) and sets `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `WORKOS_API_BASE_URL`, `WORKOS_ENVIRONMENT_ID` and `WORKOS_WEBHOOK_SECRET` on it. The stack passes the web app its emulator settings, including `WORKOS_API_HOSTNAME`, `WORKOS_API_PORT` and `WORKOS_API_HTTPS` for authkit-nextjs, as process environment, which Next.js prefers over `apps/web/.env.local`, so the dev wiring in that file stays as it is. `bun run doctor --target web --profile e2e` checks the checkout.

The emulator is started with:

- the interactive login pages, with the password step, like hosted AuthKit,
- `https://api.workos.com` as the token issuer, which the backend requires,
- a JWT template that adds `email` and `email_verified` to session tokens, like Teak's WorkOS environment,
- a webhook endpoint for `user.*` events at the backend's `/workos/webhook`, signed with the pinned test secret.

A small proxy in front of the emulator adds hosted AuthKit's 30-second refresh-token grace window ([session resilience](https://workos.com/docs/authkit/session-resilience)). The web client refreshes its session on every page load, and without the window a navigation that interrupts that refresh would end the session.

The backend runs with `convex dev --once --start`, so the suite's own file writes never trigger a push.

## Accounts

Accounts are real WorkOS users in the emulator. Creating one through the emulator API sends a signed `user.created` webhook, which gives the address a Teak vault, and the test then signs in through the hosted login page (`src/helpers/app.ts`). The primary setup account starts unverified, so its first sign-in goes through the emailed verification code. The emulator never sends email: codes and reset tokens are read from its `/events` API (`src/helpers/emulator.ts`). API keys come from Settings, the way people create them.

Each project's tests sign in fresh instead of reusing saved cookies, which go stale once the client refreshes its session.

## Projects

| Project | Covers |
| --- | --- |
| `journey-setup` | Sign-up through webhooks and the verification code; one account and API key per surface |
| `journey-web-core`, `journey-web-surfaces`, `journey-web-filters` | Cards, search, filters, favorites, tags, trash and restore, bulk actions, the editor, deep links, link metadata |
| `journey-api`, `journey-cli`, `journey-mcp` | REST API with OpenAPI checks, the CLI from this checkout, every public MCP tool, contention and rate limits |
| `journey-security` | Cross-tenant access, revoked keys, hostile input, security headers, session cookie |
| `journey-a11y` | axe scans of `/` and `/settings` |
| `journey-account`, `journey-delete`, `journey-post-delete` | Password reset from the emailed token, sign-out, account deletion through Settings, dead credentials afterward |
| `web` | Markdown editor, WebMCP, sign-in entry routing, settings navigation, composer save shortcut |
| `matrix-chromium`, `matrix-firefox`, `matrix-webkit` | Sign-up, create and search in each engine |
| `docs` | Read-only checks of the published site and Teak's public production endpoints (`bun run --cwd packages/tests e2e:docs`); needs no stack, and the workflow runs it daily |

## What the local stack doesn't cover

- **File uploads, previews, renditions, import/export and AI metadata.** They need the Files Worker, R2 and Workers AI, which the local stack doesn't run. Card metadata stays `pending`, and the specs don't depend on it.
- **AuthKit Actions** (the sign-up freeze registration action). The emulator doesn't run Actions; `packages/convex/workosAuthKit.test.ts` covers it.
- **WorkOS Connect OAuth** for the CLI, extensions, Raycast and MCP. The emulator's Connect flow has no PKCE or refresh tokens. The API, CLI and MCP journeys use Teak API keys, and the browser OAuth flows have hermetic checks: `bun run --cwd packages/tests e2e:auth:runtime`, `e2e:extension:runtime`, and the `extension-oauth-runtime.yml` and `mac-oauth-runtime.yml` workflows.
- **Billing.** Polar checkout needs Polar credentials.
- **The browser extension and desktop app.** They sign in with WorkOS Connect.
