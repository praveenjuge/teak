import { chromium } from "@playwright/test";
import { env } from "../helpers/env";
import { deleteMessagesFor } from "../helpers/mailpit";
import { deleteAccountViaUi } from "../helpers/prod";

const response = await fetch(`${env.mailpitUrl}/api/v1/messages?limit=200`);
if (!response.ok) {
  throw new Error(`Mailpit sweep failed: ${response.status}`);
}
const data = (await response.json()) as {
  messages?: Array<{ To?: Array<{ Address: string }> }>;
};
const emails = [
  ...new Set(
    (data.messages ?? [])
      .flatMap((message) => message.To ?? [])
      .map((to) => to.Address.toLowerCase())
      .filter((email) => email.startsWith("e2e-"))
  ),
].slice(0, 20);

const browser = await chromium.launch();
try {
  for (const email of emails) {
    const page = await browser.newPage();
    try {
      await deleteAccountViaUi(page, { email });
    } catch (error) {
      console.warn(`sweep skipped ${email}: ${error}`);
    } finally {
      await deleteMessagesFor(email);
      await page.close();
      await new Promise((resolve) => setTimeout(resolve, 15_000));
    }
  }
} finally {
  await browser.close();
}
