import { api } from "@teak/convex";
import { gotoApp } from "../helpers/app";
import { describe } from "../helpers/test";
import { expect, generateTestContent, test } from "./fixtures";

describe("Composer and settings", () => {
  test("the save shortcut stores the composer note", async ({
    browser,
    library,
  }) => {
    const content = generateTestContent("Shortcut");
    const composer = browser
      .locator('form[data-card-creation-status="ready"]')
      .getByRole("textbox", "Markdown content", { exact: false });
    await composer.fill(content);
    await composer.press("ControlOrMeta+Enter");
    await expect(
      browser.locator("main p").filter({ hasText: content })
    ).toBeVisible();
    await expect(composer).toHaveText("");
    await expect
      .poll(async () =>
        (await library.client.query(api.cards.getCards, {})).some(
          (card: { content?: string }) => card.content === content
        )
      )
      .toBe(true);
  });

  test("account deletion stays locked until the exact phrase is typed", async ({
    browser,
    screen,
    webAccount: _signedIn,
  }) => {
    await gotoApp(browser, "/settings/security");
    await screen.getByRole("button", /delete your account/i).click();
    const dialog = screen.getByRole("dialog", "Delete Account", {
      exact: false,
    });
    const confirm = dialog.getByRole("button", "Delete account", {
      exact: false,
    });
    const phrase = dialog.getByLabel('Type "delete account" to proceed', {
      exact: false,
    });
    await expect(confirm).toBeDisabled();
    await phrase.fill("delete my account");
    await expect(confirm).toBeDisabled();
    await phrase.fill("delete account");
    await expect(confirm).toBeEnabled();
    await browser.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await gotoApp(browser, "/");
    await expect(
      screen.getByRole("textbox", "Markdown content", { exact: false })
    ).toBeVisible();
  });
});
