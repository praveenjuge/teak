import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, expect, test } from "@playwright/test";
import { cleanupE2EAccounts } from "../helpers/e2e-cleanup";
import { deleteMessagesFor } from "../helpers/mailpit";
import { clientFor, createAccount } from "../helpers/prod";

test("extension build loads and account can save the active page", async ({
  browserName,
}) => {
  test.skip(browserName !== "chromium", "Chrome extensions require Chromium");
  const extensionPath = resolve("../../apps/extension/.output/chrome-mv3");
  expect(existsSync(extensionPath)).toBe(true);
  const context = await chromium.launchPersistentContext("", {
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  const page = await context.newPage();
  const account = await createAccount(page, "extension", { remember: false });
  try {
    const serviceWorker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    const extensionId = new URL(serviceWorker.url()).host;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.locator("body")).toContainText(
      /Teak|Sign in|Adding|Added/
    );
    const created = await clientFor(account.apiKey!).cards.create({
      content: "https://example.com",
      source: "prod-e2e-extension",
    });
    expect(created.cardId).toBeTruthy();
  } finally {
    await cleanupE2EAccounts([account.email]);
    await deleteMessagesFor(account.email);
    await context.close();
  }
});
