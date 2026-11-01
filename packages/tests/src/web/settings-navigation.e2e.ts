import { expectVault, gotoApp } from "../helpers/app";
import { expect, test } from "./fixtures";
import { observeNavigation } from "./navigation-observer";

test("keeps home, not a rebuilt copy, through settings round trips from sign-in", async ({
  browser,
  library,
  screen,
  webAccount: email,
}) => {
  const draft = browser
    .locator('form[data-card-creation-status="ready"]')
    .getByRole("textbox", "Markdown content", { exact: false });
  await draft.fill("Navigation draft — do not save");
  await expect(draft).toHaveText("Navigation draft — do not save");
  await browser.evaluate(() => {
    const composer = document.querySelector<HTMLElement>(
      "form[data-card-creation-status]"
    );
    if (!composer) {
      throw new Error("composer is missing");
    }
    composer.dataset.navigationProbe = "";
    return null;
  });
  const sameComposer = browser.locator(
    "form[data-card-creation-status][data-navigation-probe]"
  );
  await screen.getByRole("link", "Settings").click();
  await expect(screen.getByRole("heading", "Settings")).toBeVisible();
  await expect(screen.getByText(email)).toBeVisible();
  await expect(browser.locator('[data-slot="page-loading"]')).toHaveCount(0);
  await library.create("Saved while settings was open");
  await browser.back();
  await expect(
    screen.getByText("Saved while settings was open").first()
  ).toBeVisible();
  await expect(sameComposer).toHaveCount(1);
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
      () => browser.back(),
      () => expect(draft).toHaveText("Navigation draft — do not save")
    );
    expect(toHome.loading).toEqual([]);
  }

  const search = screen.getByRole("combobox", "Search everything", {
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
  await browser.back();
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
  await browser.back();
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
  await expect(screen.getByRole("heading", "Settings")).toBeVisible();
  await expect(screen.getByRole("navigation", "Settings pages")).toBeVisible();
});

test("Settings pages link to each other and back through the breadcrumb", async ({
  browser,
  screen,
  webAccount: _signedIn,
}) => {
  await gotoApp(browser, "/");
  // The loading skeleton has a main landmark too, before the shortcuts listen.
  await expectVault({ browser, screen });
  await browser.keyboard.press("g");
  await browser.keyboard.press("s");
  await expect
    .poll(async () => new URL(await browser.url()).pathname)
    .toBe("/settings");

  const pages = screen.getByRole("navigation", "Settings pages");
  await pages.getByRole("link", "Appearance").click();
  await expect(
    screen.getByRole("heading", "Appearance", { level: 2 })
  ).toBeVisible();
  await expect(pages.getByRole("link", "Appearance")).toHaveAttribute(
    "aria-current",
    "page"
  );

  await browser
    .locator('[data-page-header] a[href="/settings"]')
    .first()
    .click();
  await expect
    .poll(async () => new URL(await browser.url()).pathname)
    .toBe("/settings");
});
