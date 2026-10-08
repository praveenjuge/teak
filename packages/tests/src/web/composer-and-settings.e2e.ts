import { api } from "@teak/convex";
import { expect, generateTestContent, test } from "./fixtures";

test("the save shortcut stores the composer note", async ({
  page,
  library,
}) => {
  const content = generateTestContent("Shortcut");
  const composer = page
    .locator('form[data-card-creation-status="ready"]')
    .getByRole("textbox", { name: "Markdown content" });
  await composer.fill(content);
  await composer.press("ControlOrMeta+Enter");
  await expect(
    page.getByRole("main").getByRole("paragraph").filter({ hasText: content })
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
  page,
}) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: /delete your account/i }).click();
  const dialog = page.getByRole("dialog", { name: "Delete Account" });
  const confirm = dialog.getByRole("button", { name: "Delete account" });
  const phrase = dialog.getByLabel('Type "delete account" to proceed');
  await expect(confirm).toBeDisabled();
  await phrase.fill("delete my account");
  await expect(confirm).toBeDisabled();
  await phrase.fill("delete account");
  await expect(confirm).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  // Closing the dialog deleted nothing: the vault is still open.
  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: "Markdown content" })
  ).toBeVisible();
});
