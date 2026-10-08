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
- `E2E_CLEANUP_TOKEN`: bearer token shared only by GitHub Actions and the production backend. It authorizes server-side E2E account provisioning and cleanup.
- `MAILPIT_URL`: private Mailpit HTTP origin used by the nightly signup and password-reset email canaries.
- `E2E_EMAIL_DOMAIN`: private MX-routed domain used for throwaway account inboxes.

Useful variables:

- `E2E_PUBLIC_ORIGIN` defaults to `https://teakvault.com`. The `/api` and `/mcp` paths derive from it.
- `E2E_APP_ORIGIN` defaults to `https://app.teakvault.com`
- `E2E_CONVEX_URL` and `E2E_CONVEX_SITE_URL` are required. The runner exports them to the Vite-prefixed names the extension build consumes.
- `E2E_EMAIL_DELIVERY_ENABLED=true` opts into the two real email-delivery canaries. Scheduled GitHub runs enable it; manual runs leave it disabled.

Most test accounts are provisioned as already-verified users through the token-protected backend endpoint, so manual runs send no email. With email delivery enabled, setup reads the `/register` entry first:

- Better Auth form: sends one real signup verification email.
- Paused registration: asserts the exact paused UI, preserves a screenshot, and provisions the primary account through the protected endpoint.
- Hosted WorkOS entry (`Continue`, no form): fails before creating any account. Hosted sign-up would create a WorkOS user without the `teak_e2e` flag, which cleanup and the sweep can't delete. Email-delivery runs stay red until a reviewed WorkOS signup canary exists; run with email delivery off meanwhile.

The backend for a real hosted WorkOS signup canary is in place, but no journey uses it yet. The hosted signup labels, sender, subject and code format still need live proof first.

1. `reserveE2ESignup()` calls `/api/auth/internal/e2e/signup/reserve`. The server generates an `e2e-signup-<32 hex>` recipient, records the lease, and only then checks that WorkOS has no user for it. A retry after a lost response sends the same request ID and gets the same recipient back. At most 3 leases can be live at once.
2. After hosted signup and verification, `adoptE2ESignup()` calls `/signup/adopt`.
   - The server binds the exact WorkOS user to the lease and only then sets `teak_e2e=v1` plus `teak_e2e_reservation`. It re-reads the user and qualifies the lease once the real webhook owner exists.
   - The user must have been created no earlier than 5 minutes before the empty check and no later than 5 minutes after the lease ends. That rejects an older account renamed to the address.
   - Foreign metadata or a different user for the same lease fail closed. A partly written flag on the already-bound user is completed on retry.
3. Flagged accounts with a Teak owner still go through the normal owner-bound deletion. Once that deletion completes and WorkOS returns 404 for the bound user, the same teardown run closes the lease. For an open lease, cleanup handles interruptions:
   - It adopts an in-window user.
   - A user created outside the window is refused every time, and cleanup stays red until someone reviews it.
   - A bound, unverified user with no Teak owner and no owned or verified profile is stamped for deletion first. The stamp is permanent. From then on, `linkWorkosUser`, which is the only path that creates or links a WorkOS owner (webhook, bootstrap, profile apply, import), denies that identity with `deleting_user`. Cleanup re-reads the user right before deleting and refuses if it is now verified.
   - A verified ownerless user is reported as pending.
   - An open lease with no WorkOS user is also pending (HTTP 202), never `alreadyDeleted`. A submitted signup could still land, so teardown and the sweep stay unresolved until the user appears and is cleaned up, or the lease is past the 90-day orphan window.

How cleanup reports unresolved rows:

- **Exact teardown** retries the same emails while any are pending (202), until its 120s deadline. Any failure (500) stops it at once.
- **The sweep** walks every page of a pass, even when a page is pending (202) or failed (500), so a stuck lease never stops later reservation, provider or owner pages from being cleaned. A pass whose only unresolved rows are pending repeats from the first page while time remains, so normal in-flight deletions can finish.
- The sweep fails, never succeeds, when a full pass ends with any failure or out-of-range account, or when the 120s deadline or 200-page budget ends with rows still pending. Its error lists the counts, including rows from the last full pass that the final partial pass hadn't revisited.
- Every cursor is checked for length (8 KiB), repeats within a pass, and the 200 distinct-account budget.
- An abandoned lease therefore keeps the nightly sweep red for up to 90 days, but no longer blocks other cleanup.

`waitForEmail` and `waitForEmailCode` take a `fresh: { from, sentAfter }` option. A matching message must have exactly one `To`, no `Cc` or `Bcc`, the proven sender, and a `Created` time no earlier than 60s before the request. Two such messages, two distinct matching links, or two distinct codes fail closed. `exactLinkPredicate` admits only the proven https origin and path with exactly one non-empty token parameter. Errors never include the code or the link.

The password-reset canary still drives the Better Auth `/forgot-password` form and Teak's reset email. On WorkOS, `/forgot-password` hands off to hosted AuthKit, so this canary fails there until it's rewritten against hosted reset. Teak redirects `/login` and `/register` straight to hosted AuthKit, so the accessibility scan covers `/` and `/settings`. Cleanup is browserless. Exact accounts created by a test are removed during teardown, while the scheduled sweep discovers orphan accounts directly from the production auth database. The backend accepts only the configured `e2e-*` email namespace, enforces account-age bounds, caps each sweep, and reuses the same Teak data-deletion path as user-initiated account deletion. Mailpit messages are deleted separately by exact message ID.

Manual full-suite runs can opt into email delivery with the `email_delivery` input to check the signup entry and password-reset canary before the next nightly run.

The hosted auth helpers (`signIn`, `expectAuthEntry`, the signup canary guard) have hermetic browser checks: `bun run --cwd packages/tests e2e:auth:runtime`. They use synthetic pages, not live AuthKit. `expectAuthEntry` treats a `/register` that lands on hosted sign-in instead of hosted `/sign-up` as paused sign-ups.

For a zero-email health check without the browser suites, manually dispatch the
Production E2E workflow with `preflight_only` enabled.

For local parity with GitHub Actions, put the required values in `.env.production-e2e.local` at the repo root and run `bun run --cwd packages/tests e2e:prod:local`. The local runner installs Playwright browsers, executes preflight, docs, journey, browser matrix, extension, and teardown steps, then preserves separate reports under `packages/tests/playwright-report`.

Mailpit preflight:

1. Expose host port 25 to Mailpit's internal SMTP port 1025 on `coolify.yogeshdesign.com`.
2. Allow port 25 in the Hetzner firewall.
3. Point MX for the private test email domain at the Mailpit host.
4. Send a probe email from Resend to `probe@<E2E_EMAIL_DOMAIN>` and confirm it appears in the Mailpit UI/API.

To check the Mailpit API, MX record and SMTP port without sending email or touching accounts, manually dispatch the Production Email Readiness workflow (`prod-email-readiness.yml`). It doesn't prove delivery.

Mailpit is public and unauthenticated over HTTP. That is acceptable here because these are throwaway accounts, API keys are not uploaded as artifacts, and the test password is never emailed.
