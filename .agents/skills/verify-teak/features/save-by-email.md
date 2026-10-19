# Save by email

A user turns on Save by email in Settings and sends or forwards anything to `save@in.teakvault.com` from the email they sign in with. A short email with one link becomes a link card with the sentence as its note; anything else becomes a note headed with the subject; each attachment becomes its own card. All are tagged `email`. Mail from other addresses, mail that fails its domain's DMARC check, and mail while it's off are refused at delivery; mail past 60 an hour or at the free 200-card limit is dropped without a reply.

## Sub-features

- `email-settings` turns Save by email on and off in Settings, shows the address with Copy, the sender it accepts, and when the last email arrived.
- `email-note` saves a forwarded newsletter as a clean note: no tracking images, redirect links unwrapped, "Fwd:" and the forwarding header dropped.
- `email-link` saves a one-link email as a link card, its sentence as the note.
- `email-attachments` saves each attachment as its own card, with the same formats as uploads.
- `email-refused` refuses mail while it's off, from another address, or failing DMARC, and saves a redelivered email once.

## How to get to it (user POV)

- Settings → "Save by email" row → "Off" (or "On") → the "Save by email" dialog → "Turn on" / "Copy address" / "Turn off".
- In the library: search `#email`, or open a card saved by email.

## Driving it with e2e MCP

Preconditions:

- Seed the packs on the signed-in account (local stack shown; on the dev deployment, drop the `env` prefix):
  - `env -u CONVEX_DEPLOY_KEY CONVEX_AGENT_MODE=anonymous bunx convex run devSeed:seedScenario '{"workosUserId":"<id>","scenario":"email-in"}'` (also turns Save by email on)
  - `env -u CONVEX_DEPLOY_KEY CONVEX_AGENT_MODE=anonymous bunx convex run devSeed:seedScenario '{"workosUserId":"<id>","scenario":"email-attachments"}'`
- Real delivery needs the Email Worker and Email Routing on `in-dev.teakvault.com` (dev) — see `apps/email-worker/README.md`. On the local E2E stack, `packages/tests/src/journey/16-email-in.e2e.ts` delivers `.eml` messages through the Email Worker's own code to the local backend and Files Worker.

Steps:

- **Settings.** `navigate` to `/settings`. `click` the button "Save by email: On" (seeded) → the dialog "Save by email" shows `save@in.teakvault.com` (or the dev domain), "Send from <sign-in email>…", and "Last email received …". `click` "Copy address": the toast "Address copied". `click` "Turn off": the row reads "Save by email: Off". `click` it and "Turn on" again.
- **Note.** `press` "/" and `type` "#scenario-email-in". Open the note headed "The Weekly Leaf — issue 12": it has "Read: Why maples blush" linking to `https://example.com/maples`, no tracking images, and no "utm_" in any link.
- **Link.** In the same results, the link card for `example.com/essays/slow-reading` has the note "Worth a read:".
- **Attachments.** `type` "#scenario-email-attachments" with `replace: true`: the body note and document cards "Itinerary.pdf", "Receipt.pdf", two "Scan.pdf", "請求書.pdf" are listed.
- **End to end (local stack).** `bun run --cwd packages/tests e2e src/journey/16-email-in.e2e.ts`: mail while off and mail failing DMARC are refused; after "Turn on", the email's note and its PDF appear as two cards tagged `email`; a redelivery adds nothing.
- **Dev (after deploy).** From the account's sign-in mailbox, forward a newsletter and an email with a PDF to `save@in-dev.teakvault.com`; within a minute both cards appear. From another mailbox, the send bounces with "This address can't save to Teak".

## Gotchas

- Only the sign-in email is accepted, compared without letter case. A work address that forwards for you, or a "send as" alias, isn't the sign-in email and is refused.
- The free 200-card limit and the 60-an-hour limit drop mail silently by design: no card and no bounce.
- Email Routing takes messages up to 25 MiB including encoding, so about 18 MB of attachments.
- The Settings row is hidden while signed out; the dialog's address is the deployment's (`in-dev.teakvault.com` on dev).
