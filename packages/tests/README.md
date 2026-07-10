# Teak Production E2E Tests

This private workspace package tests the live Teak production surfaces: web signup and account deletion, REST API, CLI, MCP, docs, browser matrix coverage, accessibility, security headers, credential lifecycle, and the Chrome extension build.

Run from the repo root:

```bash
bun install
bun run --cwd packages/tests e2e:prod:local
bun run --cwd packages/tests e2e:prod:docs
bun run --cwd packages/tests e2e:prod:journey
bun run --cwd packages/tests teardown
```

Required secret:

- `PROD_E2E_PASSWORD`: strong password used only for throwaway `e2e-*` production accounts. The password is never written to `.state`.
- `E2E_CLEANUP_TOKEN`: bearer token shared only by GitHub Actions and the production backend. It authorizes the server-side E2E account cleanup endpoint.
- `MAILPIT_URL`: private Mailpit HTTP origin used for verification and reset email polling.
- `E2E_EMAIL_DOMAIN`: private MX-routed domain used for throwaway account inboxes.

Useful variables:

- `PROD_APP_URL` defaults to `https://app.teakvault.com`
- `PROD_SITE_URL` defaults to `https://teakvault.com`
- `PROD_API_URL` defaults to `https://teakvault.com/api`
- `PROD_MCP_URL` defaults to `https://teakvault.com/mcp`
- `VITE_PUBLIC_CONVEX_URL` and `VITE_PUBLIC_CONVEX_SITE_URL` are required for the extension build. You can use matching `NEXT_PUBLIC_CONVEX_URL` and `NEXT_PUBLIC_CONVEX_SITE_URL` values locally.

Cleanup is browserless. Exact accounts created by a test are removed during teardown, while the scheduled sweep discovers orphan accounts directly from the production auth database. The backend accepts only the configured `e2e-*` email namespace, enforces account-age bounds, caps each sweep, and reuses the same Teak data-deletion path as user-initiated account deletion. Mailpit messages are deleted separately by exact message ID.

For local parity with GitHub Actions, put the required values in `.env.production-e2e.local` at the repo root and run `bun run --cwd packages/tests e2e:prod:local`. The local runner installs Playwright browsers, executes preflight, docs, journey, browser matrix, extension, and teardown steps, then preserves separate reports under `packages/tests/playwright-report`.

Mailpit preflight:

1. Expose host port 25 to Mailpit's internal SMTP port 1025 on `coolify.yogeshdesign.com`.
2. Allow port 25 in the Hetzner firewall.
3. Point MX for the private test email domain at the Mailpit host.
4. Send a probe email from Resend to `probe@<E2E_EMAIL_DOMAIN>` and confirm it appears in the Mailpit UI/API.

Mailpit is public and unauthenticated over HTTP. That is acceptable here because these are throwaway accounts, API keys are not uploaded as artifacts, and the test password is never emailed.
