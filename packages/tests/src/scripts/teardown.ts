import { chromium } from "@playwright/test";
import { deleteMessagesFor } from "../helpers/mailpit";
import { deleteAccountViaUi } from "../helpers/prod";
import { readState } from "../helpers/run-state";

const browser = await chromium.launch();
try {
  for (const account of readState().accounts.filter((item) => !item.deleted)) {
    const page = await browser.newPage();
    try {
      await deleteAccountViaUi(page, account);
    } catch (error) {
      console.warn(`teardown skipped ${account.email}: ${error}`);
    } finally {
      await deleteMessagesFor(account.email);
      await page.close();
    }
  }
} finally {
  await browser.close();
}
