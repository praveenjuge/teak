# Save by email

A user turns on Save by email in Settings and sends or forwards anything to `save@in.teakvault.com` from their sign-in email. A short one-link email becomes a link card; anything else becomes a note headed with the subject; attachments become their own cards. All are tagged `email`. Refused mail is rejected at delivery; mail past 60 an hour or at the free 200-card limit is dropped without a reply.

## Sub-features

- `email-settings` toggles the feature and shows the address with Copy, the accepted sender and the last email's time.
- `email-note` saves a forwarded newsletter as a clean note: no tracking images, redirect links unwrapped, "Fwd:" and the forwarding header dropped.
- `email-link` saves a one-link email as a link card, its sentence as the note.
- `email-attachments` saves each attachment as a card, in the formats uploads accept.
- `email-refused` refuses mail while off, from another address, or failing DMARC, and saves a redelivered email once.

## How to get to it (user POV)

- Settings → Integrations (`/settings/integrations`) → region "Save by email" → switch "Save by email" / "Copy address". Account's Integrations summary reads "Save by email on" or "Save by email off".
- Library: search `#email`.

## Driving it with e2e MCP

Preconditions:

- Seed the packs on the signed-in account (local stack shown; on the dev deployment, drop the `env` prefix):
  - `env -u CONVEX_DEPLOY_KEY CONVEX_AGENT_MODE=anonymous bunx convex run devSeed:seedScenario '{"workosUserId":"<id>","scenario":"email-in"}'` (also turns Save by email on)
  - `env -u CONVEX_DEPLOY_KEY CONVEX_AGENT_MODE=anonymous bunx convex run devSeed:seedScenario '{"workosUserId":"<id>","scenario":"email-attachments"}'`
- On dev, Email Routing on `in-dev.teakvault.com` delivers to `core-worker-dev` ("Save by email" in `apps/core-worker/README.md`). Locally, `packages/tests/src/journey/16-email-in.e2e.ts` delivers `.eml` messages through the Core Worker's email handler.

Steps:

- **Settings.** `/settings`: the Integrations summary reads "Save by email on · …". `/settings/integrations`: region "Save by email" has the switch "Save by email" checked, `save@in.teakvault.com` (or the dev domain), then "Send from <sign-in email>…  Last email received …". `click` "Copy address": toast "Address copied". `click` the switch: unchecked, the address is gone, and Account's summary reads "Save by email off". Turn it back on.
- **Note.** `press` "/" and `type` "#scenario-email-in". The note "The Weekly Leaf — issue 12" has "Read: Why maples blush" linking to `https://example.com/maples`, no tracking images, and no "utm_" in any link.
- **Link.** The link card for `example.com/essays/slow-reading` has the note "Worth a read:".
- **Attachments.** `type` "#scenario-email-attachments" with `replace: true`: the body note and document cards "Itinerary.pdf", "Receipt.pdf", two "Scan.pdf", "請求書.pdf".
- **End to end (local stack).** `bun run --cwd packages/tests e2e src/journey/16-email-in.e2e.ts`: mail while off and mail failing DMARC are refused; after "Turn on", the note and its PDF appear as two cards tagged `email`; a redelivery adds nothing.
- **Dev (after deploy).** From the sign-in mailbox, forward a newsletter and an email with a PDF to `save@in-dev.teakvault.com`: both cards appear within a minute. Another mailbox bounces with "This address can't save to Teak".

## Gotchas

- Only the sign-in email is accepted (case-insensitive); a forwarding work address or "send as" alias is refused.
- The 200-card and 60-an-hour limits drop mail silently by design: no card, no bounce.
- Email Routing takes messages up to 25 MiB including encoding, about 18 MB of attachments.
- Settings needs a signed-in account. Its address is the deployment's (`in-dev.teakvault.com` on dev), read like the Worker's via `inboundEmailDomain` in `packages/files-protocol/src/inboundEmail.ts` (trimmed, lowercase, `in.teakvault.com` when unset).
- An unnamed attachment is kept when the file registry knows its type, named `attachment-<n>.<extension>` (`extensionForMimeType`, `packages/convex/shared/fileFormats.ts`): an unnamed `audio/x-wav` part becomes `attachment-1.wav`. `bun test apps/core-worker/src/email/attachments.test.ts` covers it.
