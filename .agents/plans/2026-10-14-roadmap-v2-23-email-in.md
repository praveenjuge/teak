## Goal

Give every person a private address, `save+<token>@in.teakvault.com`. Mail sent or forwarded to it becomes cards: a link card when the body is essentially one link, otherwise a Markdown text card. Every card is tagged `email`. Phase 23 of the [roadmap v2](2026-10-14-roadmap-v2-00-roadmap.md).

## Depends on

- Nothing in v2. v1 phase 19 (Hardening) has shipped.

## Success Criteria

- Settings has a "Save by email" row. Its dialog turns the address on, copies it, regenerates it (the old address stops working at once) and disables it.
- Mail to an active address creates cards within a minute:
  - The body is essentially one link (one http(s) URL plus at most 280 characters of other text): a **link card**. The other text goes into the card's notes.
  - Anything else: a **text card**. The subject becomes a `#` heading and the body is converted to Markdown, with tracking pixels and images removed and redirect wrappers unwrapped.
  - Every card gets the user tag `email` and `metadata.source: "email"`. There are no subject hashtags and no folder suffix.
- Unknown, disabled and regenerated-away tokens are rejected at SMTP time. Mail that arrives when the free 200-card limit is reached is dropped silently, with no reply.
- Delivery is idempotent: a retried message never creates a second card.
- `GET/POST /v1/inbound-address`, MCP `teak_v1_get_inbound_address`, SDK `inboundAddress.*` and CLI `teak email` all work.

## Context And Current Facts

- **No inbound email today.** Resend only sends mail. It brings `postal-mime@2.7.3` into `bun.lock` as a transitive dependency, so pinning it directly adds no new package.
- **Webhook template.** `workosWebhook.ts` handles an inbound webhook in this order:
  - `503` when the secret is missing
  - `401` for a missing signature or one over 1,024 characters
  - `415` when the body isn't JSON
  - reads the body within a limit with `readResponseTextWithinLimit` (`shared/boundedResponse.ts`), and returns `413` past it
  - verifies the signature on the exact body
  - returns `200` for payloads it can never apply (dead-lettered), and `500` only for retryable failures

  WorkOS verifies through its own SDK (`constructEvent`), so the HMAC itself comes from the Files Worker protocol instead:
  - `buildFilesOpSigningPayload` (`packages/files-protocol/src/index.ts`) binds the request id, expiry and body SHA-256
  - `hmacSha256Hex` lives in `storage/r2Keys.ts`
  - `timingSafeEqualHex` lives in `apps/files-worker/src/lib.ts`
- **Routes.** `http.ts` registers routes directly. WorkOS routes come in through `registerWorkosRoutes`. `/v1/*` paths get an `OPTIONS` route from the list at `http.ts:73`.
- **Card creation.**
  - `createCardForUserHandler(ctx, userId, args, { source })` in `card/createCard.ts` calls `authorizeCardCreation` (`card/quota.ts`). That checks the `cardCreation` token bucket (30 per minute, 6 shards) and then `FREE_TIER_LIMIT`. At the limit it throws `CARD_LIMIT_REACHED`; when the bucket is empty it throws `RATE_LIMITED` with `retryAt`.
  - `metadata.source` is a free `v.optional(v.string())` (`schema.ts:162`).
  - `CardCreationSource` (`shared/analytics.ts:12`) has no `"email"` value yet.
- **Text limits.** Text card content goes through `validateTextCardContent`, capped at `MARKDOWN_CONTENT_MAX_BYTES` = 512 KiB (`shared/markdown.ts`). There is no HTML-to-Markdown converter anywhere in the repo. `htmlparser2` ^12 is already a `packages/convex` dependency.
- **Environment.**
  - Convex env vars are declared in `packages/convex/convex.config.ts` (`defineApp({ env })`) and read through `env`.
  - Contract entries live in `scripts/env-contract-entries-backend.ts`.
  - `EnvTarget` (`scripts/env-contract-types.ts`) and `TARGET_SPECS` (`scripts/env-targets.ts`) have no `email-worker` target.
  - The E2E stack sets backend secrets in `packages/tests/src/stack/config.ts`.
- **Worker template.** `apps/files-worker` provides the layout to copy:
  - `wrangler.jsonc`, with `compatibility_date` `2026-08-01`, `nodejs_compat` and observability on
  - the `package.json` scripts `deploy`, `deploy:development`, `dev:local`, `test` and `typecheck`, at version `1.0.86` (lockstep)
  - a `development/wrangler.jsonc`

  The Files Worker deploys through Cloudflare Workers Builds, and `backend-deploy.yml` doesn't watch `apps/files-worker` for its own deploy.
- **Settings UI.**
  - `SettingsContent.tsx` holds the `SettingRow`s: Email, Usage, Plan, `SecuritySection`, `ImportExportSection`, Theme, Sign out.
  - `ApiKeysDialog.tsx` is the pattern for a secret you can copy, rotate and revoke.
  - Web wiring lives in `apps/web/src/app/(app)/settings/SettingsPageClient.tsx`.

## Constraints And Non-goals

- New per-user tables go into `accountDeletionData.ts ancillaryPage`. Receipts are also pruned by `operationalRetention.ts`.
- Rate limits go into `shared/rateLimits.ts`. New secrets go into `scripts/env-contract-entries-backend.ts`, and their names into `convex.config.ts`.
- **No replies of any kind.** That covers bounces for quota and confirmation mail. Unknown addresses are rejected inside the SMTP session (`message.setReject`), which causes no backscatter.
- No attachments here; phase 24 adds them. The worker sends only the bodies and ignores attachment parts.
- The Convex parser of the worker payload ignores unknown fields, so phase 24's worker can deploy first.
- Never log message bodies, subjects, full addresses or tokens. Log the first 6 characters of the token hash only.
- Public API order: `publicApiInboundAddress.ts`, then `publicApiHttpInboundAddress.ts`, then `executePublicApiOperation`, then `http.ts` (`/v1/inbound-address` plus `OPTIONS`), then `publicApiOpenApi.ts`, then `mcp/tools.ts`, then `client/sdk.ts`, then the CLI.

## Email Worker

- New `apps/email-worker` (`@teak/email-worker`, lockstep version):
  - `src/index.ts` exports `email(message, env, ctx)`.
  - `wrangler.jsonc` is named `teak-email-in` and has no routes, with workers.dev turned off. Its vars: `CONVEX_SITE_URL` and `MAX_BODY_BYTES` (1 MiB). Its secret: `EMAIL_INBOUND_SIGNING_SECRET`.
  - `development/wrangler.jsonc` points at the dev deployment for the staging subdomain.
- Steps for each message:
  1. The envelope `to` must match `^save\+([a-z2-7]{16})@<domain>$`, ignoring case. Otherwise `setReject("550 5.1.1 Unknown address")`.
  2. Skip auto-replies and bounces: `Auto-Submitted` other than `no`, an empty envelope sender, or `Precedence: bulk|junk` combined with a `List-Id` loop.
  3. Parse the message with `PostalMime.parse(message.raw)`.
  4. Build `{ v: 1, token, from, subject, messageId, date, text, html, authResults }`, with `text` and `html` cut to `MAX_BODY_BYTES`.
  5. Sign it: `x-teak-timestamp` plus `x-teak-signature` = HMAC-SHA256 hex of `"inbound-email\n1\n<timestamp>\n<sha256(body)>"`.
  6. POST it to `${CONVEX_SITE_URL}/inbound/email`, with 3 tries and backoff.
  7. Act on the response:
     - `200`: accept the message.
     - `404 unknown_address`: `setReject` as in step 1.
     - `5xx` (including `503 rate_limited`) after the retries: throw, so the sending server retries. Confirm Email Routing's behaviour in the spike.
- Bun tests use `.eml` fixtures in `src/fixtures/`.
- `README.md` doubles as the **deploy runbook**:
  - DNS for `in.teakvault.com`: Email Routing on the subdomain and its MX records
  - the catch-all rule that sends mail to the `teak-email-in` Worker
  - setting the secret on both sides
  - the dev subdomain and rollback (disable the catch-all)

## Backend

- `schema.ts`:
  - `inboundAddresses { userId, tokenHash, version, status: "active" | "disabled", createdAt, updatedAt, lastReceivedAt? }`, with `by_userId` and `by_tokenHash`.
  - `inboundEmailReceipts { userId, messageKey, cardIds, createdAt }`, with `by_userId_and_messageKey`, `by_userId` and `by_createdAt`. `messageKey` is the SHA-256 of the token hash plus the Message-ID, or of the body hash when the Message-ID is missing.
- `inbound/address.ts`:
  - `token = base32(HMAC(INBOUND_ADDRESS_SECRET, userId:version))[0..16]`, and only `sha256(token)` is stored. The address can always be shown again, and a database leak alone reveals nothing. The token is lowercased wherever it is derived, shown, hashed or looked up (`normalizeInboundToken`), so a mail client or MTA that changes the letter case of the local part still matches.
  - Mutations `enable`, `regenerate` (`version + 1`) and `disable`. Query `get` returns the address only for its owner.
  - `INBOUND_EMAIL_DOMAIN` defaults to `in.teakvault.com`; the dev deployment overrides it.
- `inbound/emailContent.ts` is pure:
  - `planEmailCards(email)` returns `{ kind: "link", url, notes? } | { kind: "text", markdown } | { kind: "empty" }`.
  - HTML is converted to Markdown with `htmlparser2`. It drops `<img>`, `<style>`, `<script>`, hidden elements and the forwarded-message header block.
  - Links are unwrapped when the destination sits in a query parameter (`url`, `u`, `q`, `target`, `redirect`, Google `/url`, Outlook safelinks). `utm_*`, `mc_cid` and `mc_eid` are stripped.
  - `text/plain` is used when it exists, and HTML otherwise.
  - The result is cut to fit 512 KiB.
- `inbound/http.ts`:
  - `inboundEmail` is an `httpAction`, built like `workosWebhook`. It verifies the timestamp (±5 minutes) and the signature (constant time).
  - It then runs the internal mutation `ingestEmail`:
    1. Look up the token hash. A missing or disabled address returns `404`.
    2. Check the per-address and per-sender rate limits.
    3. Check the receipt; an existing one returns its `200` again.
    4. Create the card through `createCardForUserHandler(..., { source: "email" })` with `tags: ["email"]` and `metadata: { source: "email" }`.
    5. `CARD_LIMIT_REACHED` means the mail is dropped silently: the receipt is stored and the route returns `200 dropped`.
    6. `RATE_LIMITED` from the `cardCreation` bucket is temporary, because the bucket refills within a minute. `ingestEmail` catches it before writing anything and returns `{ status: "rate_limited", retryAt }`. The route then answers `503 rate_limited` with `Retry-After`, and no receipt is written. The worker treats it like any other retryable `5xx` (worker step 7): it retries, then throws so the sending server tries again later. A later delivery that finds room is saved normally.
  - `http.ts` adds `POST /inbound/email`.
- Rate limits:
  - `inboundEmailPerAddress`: 60 per hour
  - `inboundEmailPerSender`: 20 per hour, keyed by the token hash plus the sender hash
  - `inboundEmailUnknown`: a shared bucket like `invalidApiAuth`

  Over a limit, the mail is dropped silently with `200`.
- `shared/analytics.ts`:
  - `CardCreationSource` gains `"email"`.
  - New events: `email_received { outcome: "saved" | "dropped_limit" | "dropped_rate" | "deferred_rate" | "empty" | "duplicate" }` and `email_address_changed { action }`.
- New env vars (contract, `convex.config.ts` and the E2E stack):
  - `EMAIL_INBOUND_SIGNING_SECRET`: convex plus a new `email-worker` target
  - `INBOUND_ADDRESS_SECRET`: convex only
  - `INBOUND_EMAIL_DOMAIN`: optional
- Add the `email-worker` target to `env-contract-types.ts` and `env-targets.ts`, with `apps/email-worker/.dev.vars`.

## Web

- `packages/ui/src/components/settings/InboundEmailDialog.tsx`:
  - when off: one primary "Turn on" button
  - when on: the address in a read-only `Input`, Copy (with a toast), Regenerate (a confirm dialog that says the old address stops working), Disable, and muted "Last email received {relative time}"
  - a short how-to: "Forward or send anything. Links become link cards; everything else becomes a note tagged email."
- A new `SettingRow title="Save by email"` goes in `SettingsContent.tsx` after Plan. It's wired in `SettingsPageClient.tsx`.

## API / MCP / SDK / CLI

- `GET /v1/inbound-address` returns `{ status: "off" | "active" | "disabled", address: string | null, lastReceivedAt: number | null }`.
- `POST /v1/inbound-address` takes `{ action: "enable" | "regenerate" | "disable" }` and returns the same shape. It's limited to 5 per minute.
- MCP `teak_v1_get_inbound_address` is read-only. Regenerating stays on API, CLI and web.
- SDK: `inboundAddress.get()`, `.enable()`, `.regenerate()`, `.disable()`.
- CLI: `teak email` (prints the address), `teak email enable`, `teak email regenerate` (with a prompt; `--yes` skips it), `teak email disable`, and `--json` on each.

## Docs

- `features.mdx`: a new "Save by email" subsection covering the address, the link versus note rule, the `email` tag, and that mail over the free limit is dropped silently.
- `(developers)/api.mdx`, `mcp.mdx` and `(apps)/cli.mdx`.
- `(legal)/privacy-policy.mdx`: add received email content as a data source. Confirm the wording with the owner.
- The ship month's changelog: "Save to Teak by email".

## UI states

- Empty: "Save by email is off." with "Turn on".
- Loading: an address-row skeleton. Turn on and Regenerate disable their button while pending.
- One or many: there's one address per account; "Last email received" appears after the first email.
- Very long names: the address truncates in the middle on 390px, and Copy always copies the full address.
- Error: "Couldn't update your address. Try again."
- Rate-limited: "Too many changes. Try again in a minute."

## Scenario seed packs

- `email-in`, as `devSeed.seedScenario` plus `.eml` fixtures in `apps/email-worker/src/fixtures/`:
  - HTML-only, plain text only and multipart mail
  - a 5-level forward chain
  - a newsletter with 40 tracking pixels and Mailchimp, Substack, Google and safelinks redirects
  - a bare link, a link plus a sentence, and two links
  - an empty body with a subject
  - a 26 MB message, a 2 MB HTML body, and RTL, CJK and emoji subjects
  - an auto-reply and a bounce
  - an unknown token, a disabled token and a regenerated-away token
  - an account at 199 and at 200 cards
  - the same Message-ID twice

## Break-it checklist

- UI: double-click Regenerate, copy then regenerate in two tabs, Disable then Turn on, check at 390px, use the keyboard only, and go offline mid-regenerate.
- Worker: malformed MIME, a missing Message-ID, a non-UTF-8 charset, a 25 MiB limit hit, a Convex `500` then `200` (no duplicate), and a clock 6 minutes off (rejected).
- Backend:
  - signature tampering on the body, the timestamp or the header length
  - receipt replay, OCC with 10 parallel posts
  - quota at 200 (silent drop)
  - the `cardCreation` bucket empty: expect `503 rate_limited` with `Retry-After`, no receipt, and a later retry that saves exactly one card
  - another user's token hash
  - account deletion removes both tables, and regenerating invalidates at once
- Real mail: send from Gmail, iCloud and Outlook to the dev address on the staging subdomain.

## Tests

- `apps/email-worker/src/index.test.ts`: address matching (including a mixed-case local part such as `Save+AbC…@In.TeakVault.com`), auto-reply skip, signing payload, reject versus accept per status (fetch mocked).
- `packages/convex/__tests__/inbound/emailContent.test.ts`: a fixture table of HTML to Markdown, one-link detection, unwrapping, pixel removal and truncation.
- `packages/convex/__tests__/inbound/address.test.ts`: token derivation is stable per version, the hash matches, regenerate changes the token, and a mixed-case token hashes the same as its lowercase form.
- `packages/convex/inboundEmail.test.ts` (convex-test, add to `vitest.config.ts`): signature check, idempotent receipt, silent drop at 200, `RATE_LIMITED` mapped to `503` with no receipt and a retry that saves once, unknown and disabled `404`, `email` tag and source, account deletion cascade.
- `packages/convex/__tests__/publicApiHttpInboundAddress.test.ts` and `mcp.test.ts`, plus `apps/cli/src/commands.test.ts`.
- `packages/ui/src/components/settings/__tests__/InboundEmailDialog.contract.test.tsx`.
- `scripts/env-contract.test.ts` covers the new entries and target.
- `packages/tests/src/journey/14-email-in.e2e.ts`: enable the address in Settings, POST a signed fixture to the local backend's `/inbound/email`, and see the card in the grid.

## Proof before the PR

- Video 1: turn on the address and copy it, forward a real newsletter from Gmail, and see the clean text card tagged `email`.
- Video 2: regenerate the address, then send to the old one (the sender gets a rejection) and to the new one (a card arrives).
- Screenshots of the dialog off, on, after regenerate, in error and rate-limited, in light and dark, at 390px and 1440px. Also the resulting link and text cards.
- Captured `GET/POST /v1/inbound-address` exchanges, MCP output and `teak email` output. Worker logs show no content.

## Release gate

1. Run the narrow tests above, then the repo checks, `14-email-in.e2e.ts`, `03-api.e2e.ts`, `04-cli.e2e.ts` and `05-mcp.e2e.ts`. Run `/security-review`.
2. Seed `email-in`, run the break-it pass, and fix every bug with a regression test.
3. Send the proof bundle.
4. Deploy in this order:
   1. Deploy `apps/email-worker` first: `bun run --cwd apps/email-worker deploy`, and put the secret with `wrangler secret put`. No Email Routing rule exists yet, so no mail reaches it.
   2. Set `EMAIL_INBOUND_SIGNING_SECRET` and `INBOUND_ADDRESS_SECRET` in Convex production.
   3. Merge the PR. Convex and web deploy.
   4. Turn on Email Routing for `in.teakvault.com` with the catch-all rule pointing at the Worker.
   5. There's no backfill.
5. Smoke test: enable a test account's address, send mail from an outside account, and confirm the card. Then regenerate and confirm the old address bounces.

## Risks And Open Questions

- **Fact versus the master plan.** The master plan says the signature check "copies `workosWebhook.ts`". That route verifies through the WorkOS SDK, not an HMAC. This phase copies its response structure, and takes the HMAC and replay window from the Files Worker protocol.
- **Hashed token versus copying it again.** The master plan says the table stores a hash of the token. Storing only a random token's hash would make the address impossible to show again. Deriving the token from `INBOUND_ADDRESS_SECRET` keeps only a hash at rest while still letting Settings show it. The owner should confirm.
- **Email Routing on a subdomain.** Check, in the deploy spike, that subdomain catch-alls work, that `+` survives to `message.to`, and how a thrown error is retried.
- **Spoofed senders.** Anyone holding the address can add cards, which is the stated trade-off. Should mail that fails DMARC (`authResults`) be dropped too? Proposed yes.
- Over a rate limit, mail is dropped silently, which matches the rule for the card limit. Should a temporary SMTP rejection be used instead?
- The dev subdomain's name (`in-dev.teakvault.com` proposed) needs the owner's DNS approval.
