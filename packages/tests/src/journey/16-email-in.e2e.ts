import {
  handleEmail,
  REJECT_CANT_SAVE,
} from "../../../../apps/email-worker/src/index";
import type { InboundMessage } from "../../../../apps/email-worker/src/types";
import { clientFor, createAccount, expectVault, gotoApp } from "../helpers/app";
import { env } from "../helpers/env";
import { expect, test } from "../helpers/test";
import { E2E_EMAIL_INBOUND_SIGNING_SECRET } from "../stack/config";

// Save by email end to end: the Email Worker's own code reads a message as
// Cloudflare hands it over and posts to this stack's backend, which saves the
// body as a card and the attachment through the local Core Worker.

const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"
).toString("base64");

/** A message as Email Routing delivers it, with Cloudflare's DMARC verdict. */
const message = (from: string, marker: string, dmarc = "pass") => {
  const domain = from.split("@")[1];
  const raw = [
    `ARC-Authentication-Results: i=1; mx.cloudflare.net; dkim=pass header.d=${domain} header.s=s1 header.b=AbC; dmarc=${dmarc} header.from=${domain} policy.dmarc=none; spf=pass smtp.mailfrom=${from}; arc=none`,
    `From: Ada Example <${from}>`,
    "To: save@in.teakvault.com",
    `Subject: Fwd: ${marker} notes from the trip`,
    "Date: Tue, 14 Oct 2026 09:30:00 +0000",
    `Message-ID: <${marker}-${dmarc}@mail.example.org>`,
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="b"',
    "",
    "--b",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    `The ${marker} itinerary is attached. We leave at eight and walk the ridge before lunch.`,
    "--b",
    'Content-Type: application/pdf; name="itinerary.pdf"',
    'Content-Disposition: attachment; filename="itinerary.pdf"',
    "Content-Transfer-Encoding: base64",
    "",
    PDF,
    "--b--",
    "",
  ].join("\r\n");
  const rejections: string[] = [];
  const inbound: InboundMessage = {
    from,
    headers: new Headers({ from }),
    raw,
    rawSize: raw.length,
    setReject: (reason) => {
      rejections.push(reason);
    },
    to: "save@in.teakvault.com",
  };
  return { inbound, rejections };
};

const deliver = (inbound: InboundMessage) =>
  handleEmail(
    inbound,
    {
      CONVEX_SITE_URL: env.apiUrl,
      EMAIL_INBOUND_SIGNING_SECRET: E2E_EMAIL_INBOUND_SIGNING_SECRET,
      INBOUND_EMAIL_DOMAIN: "in.teakvault.com",
      MAX_BODY_BYTES: "1048576",
    },
    {
      fetch: (input, init) => fetch(input, init),
      log: () => undefined,
      now: () => Date.now(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      timeout: (ms) => AbortSignal.timeout(ms),
    }
  );

test("save by email: turn it on, then mail and its attachment become cards", {
  timeout: 300_000,
}, async ({ browser, screen }) => {
  const account = await createAccount({ browser, screen }, "email");
  const api = clientFor(account.apiKey ?? "");
  const marker = `mail${Date.now().toString(36)}`;

  // Off: mail from the owner is refused at delivery.
  const early = message(account.email, `${marker}early`);
  await deliver(early.inbound);
  expect(early.rejections).toEqual([REJECT_CANT_SAVE]);

  await gotoApp(browser, "/settings/integrations");
  await screen
    .getByRole("region", "Save by email")
    .getByRole("button", "Turn on")
    .click();
  await expect(screen.getByText("save@in.teakvault.com")).toBeVisible();
  await expect(
    screen.getByText(`Send from ${account.email}`, { exact: false })
  ).toBeVisible();

  // Mail failing DMARC is refused even from the owner's address.
  const spoofed = message(account.email, `${marker}spoof`, "fail");
  await deliver(spoofed.inbound);
  expect(spoofed.rejections).toEqual([REJECT_CANT_SAVE]);

  const sent = message(account.email, marker);
  await deliver(sent.inbound);
  expect(sent.rejections).toEqual([]);

  await expect
    .poll(
      async () =>
        (await api.cards.list({ tag: "email" })).items
          .map((card) => card.type)
          .sort(),
      { timeout: 60_000 }
    )
    .toEqual(["document", "text"]);

  // A redelivery saves nothing new.
  await deliver(message(account.email, marker).inbound);
  expect((await api.cards.list({ tag: "email" })).items).toHaveLength(2);

  await gotoApp(browser, "/");
  await expectVault({ browser, screen });
  await expect(
    screen.getByText(`${marker} notes from the trip`, { exact: false })
  ).toBeVisible({ timeout: 30_000 });
  await expect(screen.getByText("itinerary.pdf", { exact: false })).toBeVisible(
    { timeout: 30_000 }
  );
});
