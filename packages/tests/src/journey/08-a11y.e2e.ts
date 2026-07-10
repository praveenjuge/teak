import { AxeBuilder } from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { appPath, newAnonymousContext } from "../helpers/prod";

const authPaths = new Set(["/login", "/register"]);

const waitForReadySurface = async (path: string, page: Page) => {
  if (path === "/") {
    const composer = page.locator("#content");
    await expect(composer).toBeVisible();
    await expect(composer).toBeEnabled();
    return;
  }
  if (path === "/settings") {
    await expect(
      page.getByRole("heading", { level: 1, name: "Settings" })
    ).toBeVisible();
    return;
  }
  await expect(page.locator("form")).toBeVisible();
};

for (const path of ["/login", "/register", "/", "/settings"]) {
  test(`axe serious/critical scan ${path}`, async ({ browser, page }) => {
    const context = authPaths.has(path)
      ? await newAnonymousContext(browser)
      : null;
    const scanPage = context ? await context.newPage() : page;
    try {
      await scanPage.goto(appPath(path));
      await scanPage.waitForLoadState("domcontentloaded");
      await waitForReadySurface(path, scanPage);
      const results = await new AxeBuilder({ page: scanPage })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      expect(
        results.violations.filter((item) =>
          ["serious", "critical"].includes(item.impact ?? "")
        )
      ).toEqual([]);
    } finally {
      await context?.close();
    }
  });
}
