import { AxeBuilder } from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { SIGNUPS_PAUSED_MESSAGE } from "@teak/convex/shared/constants";
import { appPath, newAnonymousContext } from "../helpers/prod";

const authPaths = new Set(["/login", "/register"]);

const waitForReadySurface = async (path: string, page: Page) => {
  if (path === "/") {
    const composer = page
      .locator('form[data-card-creation-status="ready"]')
      .getByRole("textbox", { name: "Markdown content" });
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
  const form = page.locator("form");
  if (path === "/register") {
    const paused = page.getByRole("status").filter({
      hasText: SIGNUPS_PAUSED_MESSAGE,
    });
    await expect(paused.or(form)).toBeVisible();
    if (await paused.isVisible()) {
      await expect(paused).toHaveText(SIGNUPS_PAUSED_MESSAGE);
      await expect(form).toHaveCount(0);
    }
    return;
  }
  await expect(form).toBeVisible();
};

for (const path of ["/login", "/register", "/", "/settings"]) {
  test(`axe serious/critical scan ${path}`, async ({
    browser,
    page,
  }, testInfo) => {
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
      if (path === "/register") {
        await testInfo.attach("registration-accessibility", {
          body: await scanPage.screenshot(),
          contentType: "image/png",
        });
      }
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
