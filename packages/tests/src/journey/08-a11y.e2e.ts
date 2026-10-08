import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { appPath } from "../helpers/app";
import { expect, test } from "../helpers/test";

// Sign-in and sign-up are hosted by WorkOS; Teak has no auth pages to scan.

const waitForReadySurface = async (path: string, page: Page) => {
  if (path === "/") {
    const composer = page
      .locator('form[data-card-creation-status="ready"]')
      .getByRole("textbox", { name: "Markdown content" });
    await expect(composer).toBeVisible();
    await expect(composer).toBeEnabled();
    return;
  }
  await expect(
    page.getByRole("heading", { level: 1, name: "Settings" })
  ).toBeVisible();
};

for (const path of ["/", "/settings"]) {
  test(`axe serious/critical scan ${path}`, async ({ page }) => {
    await page.goto(appPath(path));
    await page.waitForLoadState("domcontentloaded");
    await waitForReadySurface(path, page);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      results.violations.filter((item) =>
        ["serious", "critical"].includes(item.impact ?? "")
      )
    ).toEqual([]);
  });
}
