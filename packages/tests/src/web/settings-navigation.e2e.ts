import { gotoApp } from "../helpers/app";
import { expect, test } from "./fixtures";
import { observeNavigation } from "./navigation-observer";

test("preserves home through ten warm settings round trips", async ({
  browser,
  screen,
  webAccount: _signedIn,
}) => {
  // Right after sign-in, the first trip to settings remounts the composer.
  // Make that trip before typing, so every trip below takes the warm path,
  // where Next.js keeps home hidden in <Activity> and shows it again.
  await screen.getByRole("link", "Settings").click();
  await expect(screen.getByRole("heading", "Settings")).toBeVisible();
  await screen.getByRole("link", /back/i).click();
  const draft = browser
    .locator('form[data-card-creation-status="ready"]')
    .getByRole("textbox", "Markdown content", { exact: false });
  await draft.fill("Navigation draft — do not save");
  await expect(draft).toHaveText("Navigation draft — do not save");
  await screen.getByRole("link", "Settings").click();
  await expect(screen.getByRole("heading", "Settings")).toBeVisible();
  await expect(screen.getByRole("button", /@/i).first()).toBeVisible();
  await expect(browser.locator('[data-slot="page-loading"]')).toHaveCount(0);
  await screen.getByRole("link", /back/i).click();
  await expect(draft).toHaveText("Navigation draft — do not save");

  for (let index = 0; index < 10; index++) {
    const toSettings = await observeNavigation(
      browser,
      () => screen.getByRole("link", "Settings").click(),
      () => expect(screen.getByRole("heading", "Settings")).toBeVisible()
    );
    expect(toSettings.loading).toEqual([]);

    const toHome = await observeNavigation(
      browser,
      () => screen.getByRole("link", /back/i).click(),
      () => expect(draft).toHaveText("Navigation draft — do not save")
    );
    expect(toHome.loading).toEqual([]);
  }

  const search = screen.getByRole("searchbox", "Search for anything...", {
    exact: false,
  });
  await search.fill("navigation search");
  await browser.evaluate(() => {
    const settingsLink = document.querySelector<HTMLAnchorElement>(
      'a[aria-label="Settings"]'
    );
    settingsLink?.click();
    return null;
  });
  await expect(screen.getByRole("heading", "Settings")).toBeVisible();
  await screen.getByRole("link", /back/i).click();
  await expect(search).toHaveValue("navigation search");
  await search.fill("");
  await expect(draft).toHaveText("Navigation draft — do not save");

  await browser.evaluate(() => {
    const spacer = document.createElement("div");
    spacer.dataset.navigationTestSpacer = "";
    spacer.style.height = "2000px";
    document.body.append(spacer);
    window.scrollTo(0, 600);
    return null;
  });
  await expect.poll(() => browser.evaluate(() => window.scrollY)).toBe(600);
  await browser.evaluate(() => {
    document
      .querySelector<HTMLAnchorElement>('a[aria-label="Settings"]')
      ?.click();
    return null;
  });
  await expect(screen.getByRole("heading", "Settings")).toBeVisible();
  await screen.getByRole("link", /back/i).click();
  await expect.poll(() => browser.evaluate(() => window.scrollY)).toBe(600);
  await browser.evaluate(() => {
    const spacer = document.querySelector("[data-navigation-test-spacer]");
    if (!spacer) {
      throw new Error("navigation test spacer is missing");
    }
    spacer.remove();
    return null;
  });

  await screen.getByRole("link", "Settings").click();
  await expect(screen.getByRole("heading", "Settings")).toBeVisible();
  await browser.back();
  await expect(draft).toHaveText("Navigation draft — do not save");
  await browser.forward();
  await expect(screen.getByRole("heading", "Settings")).toBeVisible();
  await browser.back();
  await expect(draft).toHaveText("Navigation draft — do not save");
});

test("loads settings directly for an authenticated session", async ({
  browser,
  screen,
  webAccount: _signedIn,
}) => {
  await gotoApp(browser, "/settings");
  await expect(screen.getByRole("link", /back/i)).toBeVisible();
  await expect(screen.getByRole("heading", "Settings")).toBeVisible();
});
