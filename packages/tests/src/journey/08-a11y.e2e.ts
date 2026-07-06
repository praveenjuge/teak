import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const path of ["/login", "/register", "/", "/settings"]) {
  test(`axe serious/critical scan ${path}`, async ({ page }) => {
    await page.goto(path);
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
