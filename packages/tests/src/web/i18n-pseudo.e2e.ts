import en from "../../../i18n/messages/en.json";
import { gotoApp } from "../helpers/app";
import { expect, test } from "./fixtures";

// The development pseudo-locale wraps every catalog string as
// "[Ŝéţţîñĝš ~~~]", so plain English left on screen is a missed string.
test("the pseudo-locale reaches the sidebar, search and settings", async ({
  browser,
  screen,
  webAccount: _account,
}) => {
  await gotoApp(browser, "/?__locale=en-XA");
  const search = screen.getByRole("combobox", /^\[Šéáŕçĥ/);
  await expect(search).toBeVisible({ timeout: 30_000 });

  const english = [
    en.lib.libraryViews.labels.all,
    en.lib.libraryViews.labels.favorites,
    en.lib.libraryViews.labels.archive,
    en.sidebar.nav.tags,
    en.sidebar.nav.settings,
  ];
  const text = await browser.evaluate(() => document.body.innerText);
  for (const label of english) {
    expect(text.split("\n")).not.toContain(label);
  }
  expect(text).toContain("[Évéŕýţĥîñĝ");

  // The cookie carries it to the next page, and Settings shows English in
  // the Language select, since the pseudo-locale is never a saved choice.
  await gotoApp(browser, "/settings");
  await expect(screen.getByRole("combobox", /^\[Ļáñĝûáĝé/)).toHaveText(
    /English/,
    { timeout: 30_000 }
  );
  await browser.evaluate(() => {
    // biome-ignore lint/suspicious/noDocumentCookie: clears the pseudo-locale for the next spec, as the app itself does.
    document.cookie = "teak-locale=; path=/; max-age=0";
    return null;
  });
});
