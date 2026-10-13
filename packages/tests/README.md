# Teak E2E tests

[e2e](https://e2e.tester.army/docs) journeys across Teak's web app, REST API, CLI and MCP server, run against this checkout's own local E2E stack (`src/stack/`). The stack exists only for this suite and the clean-container smoke; development always uses the shared cloud dev deployment (`bun run dev`), which the suite never touches:

- the official WorkOS emulator ([`@workos/emulate`](https://www.npmjs.com/package/@workos/emulate)), standing in for hosted AuthKit,
- a local Convex backend (API and webhooks on the next port),
- the web app.

It needs no secrets. Every WorkOS value is a test-only constant in `src/stack/config.ts`, and the emulator keeps all of it in memory. The main checkout uses web 3000, Convex 3210/3211 and the emulator 4100/4101; each linked worktree uses its own ports, so the suite runs in any worktree.

The specs drive the browser with locators and exact `expect` assertions only. They run no agent steps, so the suite needs no model or API key. The e2e skill (`.agents/skills/e2e/`) covers writing and running specs, and the full docs ship in `node_modules/e2e/docs`.

## Run it

From the repo root, with this checkout's stack stopped (`bun run dev --stop`):

```bash
bun install
(cd packages/tests && bunx e2e-web install chromium webkit)   # once
bun run --cwd packages/tests e2e
```

`e2e` checks the pinned runtimes and packages, sets up the local backend (`src/stack/backend.ts`), starts the stack, warms it up (`e2e.warmup.config.ts`), runs the Chromium suite (`e2e.config.ts`) and the WebKit half of the browser matrix (`e2e.webkit.config.ts`), and stops everything. Pass `e2e run` arguments to run something narrower instead, for example `bun run --cwd packages/tests e2e src/journey/03-api.e2e.ts` or `bun run --cwd packages/tests e2e -- --grep editor`.

To iterate, keep the stack up in one terminal and run e2e in another:

```bash
bun run --cwd packages/tests e2e:stack
cd packages/tests && E2E_TELEMETRY_DISABLED=1 bunx e2e run src/web/markdown-editor.e2e.ts:42
```

A running stack records its URLs in `.agents/.state/stack.json`, which the configs and helpers read, and logs to `.agents/.state/stack.log`. A failed test prints the path of its trace page (`.e2e/<suite>/results/<test>/trace.md`): every step with what it hit, the app's console errors and failed requests, and the screen at the failure. Add `--headed` to watch a run.

The `E2E` workflow (`.github/workflows/e2e.yml`) runs the same command daily and on demand (not on pull requests or pushes), and uploads `.e2e/` and the stack log. An on-demand run takes e2e arguments, for example `gh workflow run e2e.yml -f e2e_args='src/web'`. The `Clean Container Smoke` workflow (`.github/workflows/clean-smoke.yml`) runs `src/matrix` in Chromium from a clean checkout on every pull request and posts the result on it.

## Suites

Each config runs its own directories and writes to its own `.e2e/<suite>/`:

| Config | Runs | Against |
| --- | --- | --- |
| `e2e.warmup.config.ts` | `src/warmup/`: compiles the signed-in routes and loads the backend modules once | the local stack |
| `e2e.config.ts` | `src/journey/`, `src/web/`, `src/matrix/` in Chromium | the local stack |
| `e2e.webkit.config.ts` | `src/matrix/` in WebKit | the local stack |
| `e2e.docs.config.ts` | `src/docs/`: read-only checks of the published site and Teak's public production endpoints (`bun run --cwd packages/tests e2e:docs`); the `E2E` workflow runs it daily | production, no stack |
| `e2e.hermetic.config.ts` | `src/auth-runtime/` and `src/extension/`: the WorkOS consent and Security dialog flows and the extension's OAuth module, with every request answered by fixtures (`bun run --cwd packages/tests e2e:hermetic`); the `Extension OAuth Runtime` workflow runs it when those files change | nothing; `TEAK_E2E_HERMETIC=1` |

Files in a suite run in parallel and share nothing: every spec makes its own accounts. Tests inside a file run in order on one worker, and a `describe(..., { serial: true })` group shares one browser and its module state, for flows such as sign-up, sign-out and account deletion.

| Directory | Covers |
| --- | --- |
| `src/journey/` | Sign-up through the verification code; cards, search, filters, favorites, tags, trash and restore, bulk actions, the editor, deep links, link metadata; the REST API with OpenAPI checks, the CLI from this checkout, every public MCP tool, contention; cross-tenant access, revoked keys, hostile input, security headers, the session cookie; axe scans of `/` and `/settings`; password reset, sign-out, account deletion and dead credentials afterward |
| `src/web/` | Markdown editor, WebMCP, sign-in entry routing, settings navigation and layout, composer save shortcut |
| `src/matrix/` | Sign-up, create and search in each engine |

## How the stack is wired

`src/stack/backend.ts` points `packages/convex/.env.local` at a local backend (taking it over from the dev deployment; the next `bun run dev` selects that again) and sets `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `WORKOS_API_BASE_URL`, `WORKOS_ENVIRONMENT_ID` and `WORKOS_WEBHOOK_SECRET` on it. The stack passes the web app its emulator settings, including `WORKOS_API_HOSTNAME`, `WORKOS_API_PORT` and `WORKOS_API_HTTPS` for authkit-nextjs, as process environment, which Next.js prefers over `apps/web/.env.local`, so the dev wiring in that file stays as it is.

The emulator is started with:

- the interactive login pages, with the password step, like hosted AuthKit,
- `https://api.workos.com` as the token issuer, which the backend requires,
- a JWT template that adds `email` and `email_verified` to session tokens, like Teak's WorkOS environment,
- a webhook endpoint for `user.*` events at the backend's `/workos/webhook`, signed with the pinned test secret.

A small proxy in front of the emulator adds hosted AuthKit's 30-second refresh-token grace window ([session resilience](https://workos.com/docs/authkit/session-resilience)). The web client refreshes its session on every page load, and without the window a navigation that interrupts that refresh would end the session.

The backend runs with `convex dev --once --start`, so the suite's own file writes never trigger a push.

## Accounts

Accounts are real WorkOS users in the emulator. Creating one through the emulator API sends a signed `user.created` webhook, which gives the address a Teak vault. Browser specs then sign in through the hosted login page (`signIn` and `createAccount` in `src/helpers/app.ts`); the sign-up journey's account starts unverified, so its first sign-in goes through the emailed verification code. The emulator never sends email: codes and reset tokens are read from its `/events` API (`src/helpers/emulator.ts`). API keys come from Settings, the way people create them, except in the API, CLI and MCP specs, which never open a browser: `createApiAccount` calls the same mutation Settings does, signed in with the emulator's password grant.

Tests sign in fresh instead of reusing saved cookies, which go stale once the client refreshes its session.

## What e2e doesn't do, and the stand-ins

`src/helpers/page-hooks.ts` covers the Playwright features the specs used that e2e doesn't have, with init scripts in the page:

- `capturePageErrors` records uncaught errors and unhandled rejections (Playwright's `pageerror`).
- `blockAndRecordRequests` records and aborts requests to a URL pattern (the `request` event, for "never fetched" checks).
- `routeConvexSocket` routes the browser's Convex sync socket through interceptors that run in the page: a backend that can't be reached, an injected mutation failure, a rewritten query result (`routeWebSocket`).

`retry` and `firstVisible` in `src/helpers/test.ts` stand in for `expect(...).toPass()` and `locator.or()`. Each test has one page: a second user signs in after `app.clearState()`, or the check runs at the API.

## What the local stack doesn't cover

- **File uploads, previews, renditions, import/export and AI metadata.** They need the Files Worker, R2 and Workers AI, which the local stack doesn't run. Card metadata stays `pending`, and the specs don't depend on it.
- **AuthKit Actions** (the sign-up freeze registration action). The emulator doesn't run Actions; `packages/convex/workosAuthKit.test.ts` covers it.
- **WorkOS Connect OAuth** for the CLI, extensions, Raycast and MCP. The emulator's Connect flow has no PKCE or refresh tokens. The API, CLI and MCP journeys use Teak API keys, and the browser OAuth flows have hermetic checks: `bun run --cwd packages/tests e2e:hermetic`, and the `extension-oauth-runtime.yml` workflow.
- **Billing.** Polar checkout needs Polar credentials.
- **The browser extension.** It signs in with WorkOS Connect, and e2e can't load a browser extension.
