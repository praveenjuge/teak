import { gotoApp } from "../helpers/app";
import { expect, test } from "./fixtures";

const FONT_SWAP_SHIFT_ALLOWANCE = 0.01;

test("settings loads without shifting its layout", async ({
  browser,
  screen,
  webAccount: email,
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
  await expect(screen.getByText(email)).toBeVisible();
  await expect(screen.getByRole("progressbar", "Cards used")).toBeVisible();

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
  expect(shift).toBeLessThan(FONT_SWAP_SHIFT_ALLOWANCE);
});
