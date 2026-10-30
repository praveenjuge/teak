# Email Worker (Save by email)

`teak-email-prod` receives mail sent to `save@in.teakvault.com` through
Cloudflare Email Routing and turns it into cards. It has no HTTP routes.

Setting up Save by email on a deployment of your own is in the public
self-hosting guide (`apps/docs/content/docs/(open-source)/self-hosting.mdx`,
"Save by email"). This file covers Teak's own Workers.

## How a message is handled

1. **Address.** The envelope recipient must be `save@<INBOUND_EMAIL_DOMAIN>`;
   `save+anything@` is the same address and letter case never matters. Any
   other local part is refused in the SMTP session
   (`550 5.1.1 Unknown address`).
2. **Automated mail** (an `Auto-Submitted` header other than `no`, an empty
   envelope sender, or `Precedence: bulk|junk|list` with a `List-Id`) is
   accepted and dropped. Nothing is ever sent back.
3. **Size.** Over 25 MiB is refused (`552`). Email Routing's own cap is
   25 MiB including base64, so attachments top out around 18 MB per email.
4. **Sender.** The message is parsed with `postal-mime` (`src/auth.ts`). The
   From header must hold exactly one address, and the **topmost**
   authentication header must be Cloudflare's own (authserv-id
   `mx.cloudflare.net`) with `dmarc=pass` and `header.from` equal to that
   address's domain. Headers a sender wrote sit below Cloudflare's, so a
   forged `mx.cloudflare.net` pass further down is never read. Anything else
   is refused (`550 5.7.1 This address can't save to Teak`).
5. **Convex.** The verified sender, subject, Message-ID, date, the text and
   HTML bodies (each cut to `MAX_BODY_BYTES` as encoded in the JSON request,
   never mid-character, so the request stays under Convex's 3 MiB) and the
   attachments' names, types and sizes are POSTed to
   `${CONVEX_SITE_URL}/inbound/email`, signed with
   `EMAIL_INBOUND_SIGNING_SECRET` (`src/payload.ts`: HMAC-SHA256 of
   `teak-inbound-email\nv1\n<path>\n<timestamp>\n<sha256(body)>`).
   - `200`: accepted. Convex saved the body card, dropped the message
     silently (over the hourly limit or the free card limit), or had already
     saved it (a receipt per message makes retries safe).
   - `404 unknown_sender`: not a Teak account, Save by email turned off for
     it, or an address Convex won't take: refused with the same `550 5.7.1`.
   - `5xx` (including `503 rate_limited`) or a network failure: tried three
     times (1 s, then 3 s apart), then the handler throws so the sending
     server retries later.
   - Any other status (a signing or configuration fault): thrown at once.
6. **Attachments** (`src/attachments.ts`). Files and inline photos are kept;
   S/MIME signatures, `winmail.dat`, calendar invites and inline images the
   HTML shows that are under 16 KB (logos, spacers) are skipped; at most 50.
   For each part Convex accepted, it returns a signed Core Worker upload
   URL. The Worker PUTs the bytes (two at a time, three tries each), then
   POSTs `/inbound/email/attachments` so Convex turns it into a card. A part
   the Core Worker refuses (a 4xx other than 408 or 429) is skipped and its
   pending object swept later. If a PUT or finalize still fails for a
   transient reason (a 5xx, a 408 or 429, or the network) after the others
   are done, the Worker throws, so the sender retries the whole email; Convex's receipt then re-signs only the attachments not yet
   saved. A finalize that finds another one holding the attachment, or one
   Convex scheduled that then fails, gets a follow-up in Convex after the
   two-minute claim expires (three at most).

Logs (`wrangler tail`) carry outcomes, reasons and counts only: never an
address, a subject, a body or a file name.

## Configuration

| Name | Kind | Production | Development |
| --- | --- | --- | --- |
| `CONVEX_SITE_URL` | var | `https://uncommon-ladybug-882.convex.site` | `https://reminiscent-kangaroo-59.convex.site` |
| `INBOUND_EMAIL_DOMAIN` | var | `in.teakvault.com` | `in-dev.teakvault.com` |
| `MAX_BODY_BYTES` | var | `1048576` | `1048576` |
| `EMAIL_INBOUND_SIGNING_SECRET` | secret | its own value | its own value |

The secret is one value per environment, set on both sides: in the Convex
dashboard of the deployment, and on the Worker that posts to it.

## Deploy runbook

Do these in order. Until step 4 no mail reaches the Worker, and nothing is public until step 6.

1. **Secrets.** Generate a value per environment
   (`openssl rand -hex 32`). Set it in Convex (Settings → Environment
   variables → `EMAIL_INBOUND_SIGNING_SECRET`), then on the Worker:

   ```sh
   cd apps/email-worker
   bunx wrangler secret put EMAIL_INBOUND_SIGNING_SECRET
   bunx wrangler secret put EMAIL_INBOUND_SIGNING_SECRET --config development/wrangler.jsonc
   ```

   In Convex dev also set `INBOUND_EMAIL_DOMAIN=in-dev.teakvault.com`
   (production uses the default, `in.teakvault.com`).
2. **Deploy the Workers.** `bun run deploy` (production, `teak-email-prod`)
   and `bun run deploy:development` (`teak-email-dev`).
3. **This code on the dev deployment.** Push the branch's Convex functions
   to the shared dev deployment (`bun run dev`; see `apps/docs/content/docs/(open-source)/development.mdx`
   for the push lease). Production stays as it is until step 6.
4. **Email Routing on the subdomain.** In the Cloudflare dashboard for
   `teakvault.com`: Email Service → Email Routing → Settings → Subdomains,
   add `in-dev.teakvault.com` first. Cloudflare adds the subdomain's MX and
   TXT (SPF) records; they must not touch the root domain's mail. Catch-all
   rules work only on the apex domain, so under Routing rules add a literal
   rule for `save@in-dev.teakvault.com` with the action **Send to a
   Worker** → `teak-email-dev`. In Email Routing → Settings, turn
   on **Subaddressing**, so `save+anything@` reaches the same rule. Any
   other address on the subdomain matches no rule and is refused by
   Cloudflare.
5. **Spike on development (required before production).**
   - Turn on Save by email for a dev account in Settings.
   - Send from Gmail, iCloud and Outlook accounts to
     `save@in-dev.teakvault.com`, and once to `save+test@in-dev.teakvault.com`.
   - In `bunx wrangler tail teak-email-dev` confirm each logs
     `outcome: "saved"`, not `outcome: "rejected", reason:
     "no_cloudflare_results"`. That proves Cloudflare adds its
     `ARC-Authentication-Results` (authserv-id `mx.cloudflare.net`) as the
     topmost authentication header, which the sender check relies on. If a
     provider's mail is rejected for that reason, stop: the check must change
     before production.
   - Confirm the `+` address arrived at the Worker unchanged.
   - Send from an address with no Teak account: the sender gets a bounce
     from their own provider with `550 5.7.1`.
   - With the dev secret temporarily wrong, send once: the Worker throws
     and the sender's provider should retry (delayed delivery), not bounce.
     Restore the secret.
   - Check the cards in the dev app.
6. **Merge.** Convex, web and the docs deploy: the Settings switch, the
   docs section and the changelog entry go live together.
7. **Production routing, straight after.** Repeat step 4 for
   `in.teakvault.com`, with the literal rule for `save@in.teakvault.com`
   sending to `teak-email-prod`, then smoke-test with one email from a test
   account.

**Rollback:** disable the subdomain's `save@` rule (or Email Routing on the
subdomain). The Worker and Convex can stay deployed.

## Development

`bun test` runs the handler against `.eml` fixtures in `src/fixtures/` with
a fake network; `bun run typecheck`. `bun run dev:local` starts
`wrangler dev`, which can simulate an inbound email (see Cloudflare's Email
Workers local development docs); a local `.dev.vars` holds the secret for it.
