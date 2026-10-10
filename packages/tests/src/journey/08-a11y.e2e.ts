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
  } else {
    await expect(
      page.getByRole("heading", { level: 1, name: "Settings" })
    ).toBeVisible();
    // Settings rows fade in over skeleton placeholders as account data
    // arrives; scanning before they settle sees a partial page.
    await expect(
      page.locator('[data-slot="setting-value-skeleton"]')
    ).toHaveCount(0);
  }
  // Loaded values fade in, and axe blends mid-fade opacity into the colors
  // it measures, reporting contrast the settled page does not have. Scan
  // only once every animation on the page has finished.
  await page.waitForFunction(
    () =>
      document.getAnimations().every((animation) => {
        // Infinite loops (loading pulses) are not load transitions; the
        // skeleton wait above is what proves the content arrived.
        const timing = (animation.effect as KeyframeEffect | null)?.getTiming();
        return (
          animation.playState !== "running" ||
          timing?.iterations === Number.POSITIVE_INFINITY
        );
      }),
    undefined,
    { timeout: 10_000 }
  );
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
