import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createAccount, gotoApp } from "../helpers/app";
import { type Browser, expect, type Screen, test } from "../helpers/test";

// Sign-in and sign-up are hosted by WorkOS; Teak has no auth pages to scan.

// axe runs inside the page. An init script is added by the driver, not the
// page, so the app's Content-Security-Policy doesn't block it.
const axeSource = readFileSync(
  createRequire(import.meta.url).resolve("axe-core/axe.min.js"),
  "utf8"
);

const waitForReadySurface = async (
  path: string,
  browser: Browser,
  screen: Screen
) => {
  if (path === "/") {
    const composer = browser
      .locator('form[data-card-creation-status="ready"]')
      .getByRole("textbox", "Markdown content");
    await expect(composer).toBeVisible();
    await expect(composer).toBeEnabled();
  } else {
    await expect(
      screen.getByRole("heading", "Settings", { exact: false, level: 1 })
    ).toBeVisible();
    // Settings rows fade in over skeleton placeholders as account data
    // arrives; scanning before they settle sees a partial page.
    await expect(
      browser.locator('[data-slot="setting-value-skeleton"]')
    ).toHaveCount(0);
  }
  // Loaded values fade in, and axe blends mid-fade opacity into the colors
  // it measures, reporting contrast the settled page does not have. Scan
  // only once every animation on the page has finished.
  await expect
    .poll(
      () =>
        browser.evaluate(() =>
          document.getAnimations().every((animation) => {
            // Infinite loops (loading pulses) are not load transitions; the
            // skeleton wait above is what proves the content arrived.
            const timing = (
              animation.effect as KeyframeEffect | null
            )?.getTiming();
            return (
              animation.playState !== "running" ||
              timing?.iterations === Number.POSITIVE_INFINITY
            );
          })
        ),
      { timeout: 10_000 }
    )
    .toBe(true);
};

// The serious and critical WCAG 2 A/AA violations on the page, with the
// nodes each one flags.
const seriousViolations = (browser: Browser) =>
  browser.evaluate(async () => {
    const { axe } = window as unknown as {
      axe: {
        run: (
          context: Document,
          options: object
        ) => Promise<{
          violations: Array<{
            id: string;
            impact?: string | null;
            nodes: Array<{ target: Array<string | string[]> }>;
          }>;
        }>;
      };
    };
    const results = await axe.run(document, {
      resultTypes: ["violations"],
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
    });
    return results.violations
      .filter((item) => ["serious", "critical"].includes(item.impact ?? ""))
      .map((item) => ({
        id: item.id,
        impact: item.impact ?? null,
        nodes: item.nodes.map((node) => node.target),
      }));
  });

for (const path of ["/", "/settings"]) {
  test(`axe serious/critical scan ${path}`, { timeout: 180_000 }, async ({
    browser,
    screen,
  }) => {
    await createAccount({ browser, screen }, "a11y");
    // From the next navigation on: only the scanned page carries axe.
    await browser.addInitScript(axeSource);
    await gotoApp(browser, path);
    await waitForReadySurface(path, browser, screen);
    expect(await seriousViolations(browser)).toEqual([]);
  });
}
