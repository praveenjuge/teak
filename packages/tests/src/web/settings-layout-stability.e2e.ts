import { expect, test } from "./fixtures";

// Settings used to show inline spinners that were smaller than the values
// replacing them, so every row below "Plan" jumped once account data arrived.
test("settings loads without shifting its layout", async ({ page }) => {
  await page.addInitScript(() => {
    const target = window as unknown as { __settingsShift: number };
    target.__settingsShift = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as {
        hadRecentInput: boolean;
        value: number;
      }[]) {
        if (!entry.hadRecentInput) {
          target.__settingsShift += entry.value;
        }
      }
    }).observe({ buffered: true, type: "layout-shift" });
  });

  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /@/ })).toBeVisible();
  await expect(page.getByText("Free Plan", { exact: true })).toBeVisible();

  // Layout-shift entries are delivered after the frame that caused them.
  const shift = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        requestAnimationFrame(() =>
          requestAnimationFrame(() =>
            resolve(
              (window as unknown as { __settingsShift: number }).__settingsShift
            )
          )
        );
      })
  );
  // The old jump scored about 0.066. A cold first visit can still nudge a
  // few pixels while the web font swaps in (font-display: swap), so allow
  // that much and no more.
  expect(shift).toBeLessThan(0.01);
});
