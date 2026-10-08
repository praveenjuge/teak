import { expect, test } from "@playwright/test";
import { clientFor, createAccount } from "./helpers/app";

test.setTimeout(240_000);

// The dev server compiles each route on its first visit and a freshly pushed
// backend loads each module on its first call. Do both once, signed in and
// alone, before the suites start sharing the runner.
test("signed-in routes and backend modules are warm", async ({ page }) => {
  const { apiKey } = await createAccount(page, "warmup");
  const { cardId } = await clientFor(apiKey ?? "").cards.create({
    content: "Warm-up card",
  });
  await page.goto(`/?card=${cardId}`);
  await expect(
    page.getByRole("dialog").getByRole("textbox", { name: "Markdown content" })
  ).toBeVisible();
  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { level: 1, name: "Settings" })
  ).toBeVisible();
});
