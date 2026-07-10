import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, expect, test } from "@playwright/test";
import { cleanupE2EAccounts } from "../helpers/e2e-cleanup";
import { env } from "../helpers/env";
import { deleteMessagesFor } from "../helpers/mailpit";
import { clientFor, createAccount } from "../helpers/prod";

interface ExtensionChrome {
  runtime: {
    sendMessage: (message: unknown) => Promise<unknown>;
  };
  storage: {
    local: {
      get: (
        key: string,
        callback: (result: Record<string, unknown>) => void
      ) => void;
    };
  };
}

test("extension saves a selected file and safe page asset with private URL fallback", async ({
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
    const popupUrl = `chrome-extension://${extensionId}/popup.html`;
    const popup = await context.newPage();
    await popup.goto(popupUrl);
    const signIn = popup.getByRole("button", { name: "Sign in" });
    await expect(signIn).toBeVisible();
    const nextPage = context.waitForEvent("page");
    await signIn.click();
    const authPage = await nextPage;
    await authPage.waitForURL(/\/native\/auth\/complete/, {
      timeout: 30_000,
    });

    await expect
      .poll(
        () =>
          serviceWorker.evaluate(() => {
            const extensionChrome = (
              globalThis as typeof globalThis & { chrome: ExtensionChrome }
            ).chrome;
            return new Promise<boolean>((resolveToken) => {
              extensionChrome.storage.local.get(
                "teakSessionToken",
                (result) => {
                  resolveToken(Boolean(result.teakSessionToken));
                }
              );
            });
          }),
        { timeout: 30_000 }
      )
      .toBe(true);

    const marker = `extension-file-${Date.now()}`;
    const uploadPopup = await context.newPage();
    await uploadPopup.goto(popupUrl);
    await uploadPopup.locator('input[type="file"]').setInputFiles({
      buffer: Buffer.from(`# ${marker}\n\nSaved from the extension.`),
      mimeType: "text/mdx",
      name: `${marker}.mdx`,
    });
    await expect(uploadPopup.getByText("File saved!")).toBeVisible({
      timeout: 45_000,
    });

    const client = clientFor(account.apiKey!);
    await expect
      .poll(
        async () =>
          (
            await client.cards.list({ include: "metadata", limit: 100 })
          ).items.some((card) => card.fileName === `${marker}.mdx`),
        { timeout: 45_000 }
      )
      .toBe(true);

    const assetResult = await serviceWorker.evaluate(
      ({ assetUrl, messageType }) => {
        const extensionChrome = (
          globalThis as typeof globalThis & { chrome: ExtensionChrome }
        ).chrome;
        return extensionChrome.runtime.sendMessage({
          payload: { assetUrl },
          type: messageType,
        });
      },
      {
        assetUrl: new URL("/icon.svg", env.appUrl).toString(),
        messageType: "TEAK_SAVE_ASSET",
      }
    );
    expect(assetResult).toMatchObject({ status: "saved" });
    await expect
      .poll(
        async () =>
          (
            await client.cards.list({ include: "metadata", limit: 100 })
          ).items.some((card) => card.fileName === "icon.svg"),
        { timeout: 45_000 }
      )
      .toBe(true);

    const unsafeResult = await serviceWorker.evaluate((messageType) => {
      const extensionChrome = (
        globalThis as typeof globalThis & { chrome: ExtensionChrome }
      ).chrome;
      return extensionChrome.runtime.sendMessage({
        payload: { assetUrl: "http://127.0.0.1/private.png" },
        type: messageType,
      });
    }, "TEAK_SAVE_ASSET");
    expect(unsafeResult).toMatchObject({
      code: "UNSAFE_ASSET_URL",
      status: "error",
    });
    expect(
      (await client.cards.list({ include: "metadata", limit: 100 })).items.some(
        (card) => card.fileName === "private.png"
      )
    ).toBe(false);
  } finally {
    await cleanupE2EAccounts([account.email]);
    await deleteMessagesFor(account.email);
    await context.close();
  }
});
