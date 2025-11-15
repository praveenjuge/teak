import { expect, test } from "@playwright/test";
// import { clerk } from "@clerk/testing/playwright";

const email = process.env.E2E_CLERK_USER_EMAIL;
const password = process.env.E2E_CLERK_USER_PASSWORD;

test.skip(
  !email || !password,
  "Set E2E_CLERK_USER_EMAIL and E2E_CLERK_USER_PASSWORD to run card CRUD tests.",
);

test.describe("Text cards", () => {
  test("supports creating, updating, and deleting a card", async ({ page }) => {
    await page.goto("/login");

    // await clerk.signIn({
    //   page,
    //   signInParams: {
    //     strategy: "password",
    //     identifier: email!,
    //     password: password!,
    //   },
    // });

    await page.goto("/");

    const cardContent = `Playwright text card ${Date.now()}`;
    const updatedContent = `${cardContent} - updated`;

    const composer = page.getByPlaceholder("Write or add a link...");
    await composer.fill(cardContent);
    await page.getByRole("button", { name: "Save", exact: true }).click();

    const createdCard = page.getByRole("main").getByText(cardContent);
    await expect(createdCard).toBeVisible();

    await createdCard.click();

    const editor = page.getByPlaceholder("Enter your text...");
    await expect(editor).toBeVisible();
    await editor.fill(updatedContent);
    await page.locator('button:has-text("Save changes"):visible').click();
    await expect(editor).toHaveValue(updatedContent);

    const modal = page.getByRole("dialog");
    const box = await modal.boundingBox();
    if (!box) {
      throw new Error("Unable to determine dialog bounds");
    }

    const viewport = page.viewportSize();
    const rawOutsideX = box.x > 40 ? box.x - 20 : box.x + box.width + 20;
    const rawOutsideY = box.y > 40 ? box.y - 20 : box.y + box.height + 20;
    const outsideX = Math.min(
      Math.max(rawOutsideX, 5),
      (viewport?.width ?? rawOutsideX + 5) - 5,
    );
    const outsideY = Math.min(
      Math.max(rawOutsideY, 5),
      (viewport?.height ?? rawOutsideY + 5) - 5,
    );
    await page.mouse.click(outsideX, outsideY);

    const updatedCard = page.getByRole("main").getByText(updatedContent);
    await expect(updatedCard).toBeVisible();

    await updatedCard.click();
    await page.getByRole("button", { name: "Delete" }).click();

    await expect(page.getByRole("main").getByText(updatedContent)).toHaveCount(
      0,
    );

    // await clerk.signOut({ page });
  });
});
