import { expect, test } from "./fixtures";
import { observeNavigation } from "./navigation-observer";

// TODO(emulator-e2e): the home draft is lost after a settings round trip on
// the local dev server; find out whether the app or the dev server drops it.
test.fixme("preserves home through ten warm settings round trips", async ({
  page,
}) => {
  // The dev server compiles a route on its first visit and may reload the
  // page while it does, so open settings once before typing the draft.
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true })
  ).toBeVisible();
  await page.getByRole("link", { name: /back/i }).click();
  const draft = page
    .locator('form[data-card-creation-status="ready"]')
    .getByRole("textbox", { name: "Markdown content" });
  await draft.fill("Navigation draft — do not save");
  await expect(draft).toHaveText("Navigation draft — do not save");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /@/i }).first()).toBeVisible();
  await expect(page.locator('[data-slot="page-loading"]')).toHaveCount(0);
  await page.getByRole("link", { name: /back/i }).click();
  await expect(draft).toHaveText("Navigation draft — do not save");

  for (let index = 0; index < 10; index++) {
    const toSettings = await observeNavigation(
      page,
      () => page.getByRole("link", { name: "Settings", exact: true }).click(),
      () =>
        expect(
          page.getByRole("heading", { name: "Settings", exact: true })
        ).toBeVisible()
    );
    expect(toSettings.loading).toEqual([]);

    const toHome = await observeNavigation(
      page,
      () => page.getByRole("link", { name: /back/i }).click(),
      () => expect(draft).toHaveText("Navigation draft — do not save")
    );
    expect(toHome.loading).toEqual([]);
  }

  const search = page.getByRole("searchbox", {
    name: "Search for anything...",
  });
  await search.fill("navigation search");
  await page.evaluate(() => {
    const settingsLink = document.querySelector<HTMLAnchorElement>(
      'a[aria-label="Settings"]'
    );
    settingsLink?.click();
  });
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true })
  ).toBeVisible();
  await page.getByRole("link", { name: /back/i }).click();
  await expect(search).toHaveValue("navigation search");
  await search.fill("");
  await expect(draft).toHaveText("Navigation draft — do not save");

  await page.evaluate(() => {
    const spacer = document.createElement("div");
    spacer.dataset.navigationTestSpacer = "";
    spacer.style.height = "2000px";
    document.body.append(spacer);
    window.scrollTo(0, 600);
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(600);
  await page.evaluate(() => {
    document
      .querySelector<HTMLAnchorElement>('a[aria-label="Settings"]')
      ?.click();
  });
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true })
  ).toBeVisible();
  await page.getByRole("link", { name: /back/i }).click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(600);
  await page
    .locator("[data-navigation-test-spacer]")
    .evaluate((node) => node.remove());

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true })
  ).toBeVisible();
  await page.goBack();
  await expect(draft).toHaveText("Navigation draft — do not save");
  await page.goForward();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true })
  ).toBeVisible();
  await page.goBack();
  await expect(draft).toHaveText("Navigation draft — do not save");
});

test("loads settings directly for an authenticated session", async ({
  page,
}) => {
  await page.goto("/settings");
  await expect(page.getByRole("link", { name: /back/i })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true })
  ).toBeVisible();
});
