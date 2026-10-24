import { api } from "@teak/convex";
import deCatalog from "../../../i18n/messages/de.json";
import en from "../../../i18n/messages/en.json";
import { gotoApp } from "../helpers/app";
import { expect, test } from "./fixtures";

// The German catalog has the same keys as English (scripts/i18n-catalog.test.ts).
const de = deCatalog as typeof en;

const htmlLang = (browser: Parameters<typeof gotoApp>[0]) =>
  browser.evaluate(() => document.documentElement.lang);

test("Settings → Language switches in place, saves to the account and survives a reload", async ({
  browser,
  library,
  screen,
}) => {
  await gotoApp(browser, "/settings/appearance");
  const language = screen.getByRole("combobox", en.settings.language.label);
  await expect(language).toBeVisible({ timeout: 30_000 });
  await expect(language).toHaveText(/English/);

  await language.click();
  await screen.getByRole("option", "Deutsch", { exact: false }).click();

  // The page re-renders in German without a navigation.
  await expect(
    screen.getByRole("heading", de.settings.appearance.languageTitle)
  ).toBeVisible();
  await expect(screen.getByText(de.settings.language.changed)).toBeVisible();
  expect(await htmlLang(browser)).toBe("de");
  expect(
    await library.client.query(api.settings.preferences.getPreferences, {})
  ).toEqual({ locale: "de" });

  // The cookie and the account both say German, so a reload stays German.
  await browser.reload();
  await expect(
    screen.getByRole("combobox", de.settings.language.label)
  ).toHaveText(/Deutsch/, { timeout: 30_000 });
  await gotoApp(browser, "/");
  await expect(
    screen.getByRole("combobox", de.lib.libraryViews.searchPlaceholders.all, {
      exact: false,
    })
  ).toBeVisible({ timeout: 30_000 });

  // Back to English.
  await gotoApp(browser, "/settings/appearance");
  const german = screen.getByRole("combobox", de.settings.language.label);
  await german.click();
  await screen.getByRole("option", "English", { exact: false }).click();
  await expect(
    screen.getByRole("heading", en.settings.appearance.languageTitle)
  ).toBeVisible();
  expect(await htmlLang(browser)).toBe("en");
  expect(
    await library.client.query(api.settings.preferences.getPreferences, {})
  ).toEqual({ locale: "en" });
});
