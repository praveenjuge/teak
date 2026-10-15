import { gotoApp } from "../helpers/app";
import { expect, test } from "./fixtures";

test("settings loads without shifting its layout", async ({
  browser,
  screen,
  webAccount: _signedIn,
}) => {
  await browser.addInitScript(() => {
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

  await gotoApp(browser, "/settings");
  await expect(screen.getByRole("heading", "Settings")).toBeVisible();
  await expect(screen.getByRole("button", /@/)).toBeVisible();
  await expect(screen.getByText("Free Plan")).toBeVisible();

  // Layout-shift entries are delivered after the frame that caused them.
  const shift = await browser.evaluate(
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
