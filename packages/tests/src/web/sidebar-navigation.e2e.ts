import { expectVault, gotoApp } from "../helpers/app";
import { expect, test } from "./fixtures";

// Each library view is its own page in the sidebar. A fresh account has only
// the welcome cards (one of them a favorite), so Archive and Trash also show
// their empty states.
const VIEWS = [
  {
    name: "Favorites",
    path: "/favorites",
    placeholder: "Search favorites...",
    empty: null,
  },
  {
    name: "Archive",
    path: "/archive",
    placeholder: "Search the archive...",
    empty: "Nothing archived. Archive a card to keep it out of your library.",
  },
  {
    name: "Trash",
    path: "/trash",
    placeholder: "Search Trash...",
    empty: "Trash is empty.",
  },
] as const;

const pathOf = async (url: Promise<string>) => {
  const { pathname, search } = new URL(await url);
  return `${pathname}${search}`;
};

test("the sidebar opens each view, with back and forward", async ({
  browser,
  screen,
  webAccount: _signedIn,
}) => {
  await gotoApp(browser, "/");
  await expectVault({ browser, screen });
  await expect(screen.getByRole("link", "Everything")).toHaveAttribute(
    "aria-current",
    "page"
  );

  for (const view of VIEWS) {
    await screen.getByRole("link", view.name).click();
    await expect(screen.getByPlaceholder(view.placeholder)).toBeVisible();
    expect(await pathOf(browser.url())).toBe(view.path);
    await expect(screen.getByRole("link", view.name)).toHaveAttribute(
      "aria-current",
      "page"
    );
    if (view.empty) {
      await expect(screen.getByText(view.empty)).toBeVisible();
    }
  }

  await browser.back();
  await expect(screen.getByPlaceholder("Search the archive...")).toBeVisible();
  await browser.back();
  await expect(screen.getByPlaceholder("Search favorites...")).toBeVisible();
  await browser.forward();
  await expect(screen.getByPlaceholder("Search the archive...")).toBeVisible();

  // A card type narrows the open view and lives in the URL.
  await screen.getByRole("button", "Image").first().click();
  await expect(browser).toHaveURL(/\/archive\?type=image$/);
  await expect(screen.getByRole("button", "Image").first()).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await browser.back();
  await expect(browser).toHaveURL(/\/archive$/);
});

test("quick commands in search open their view", async ({
  browser,
  screen,
  webAccount: _signedIn,
}) => {
  await gotoApp(browser, "/");
  await expectVault({ browser, screen });
  const search = screen.getByRole("combobox");
  await search.fill("fav");
  // Let the typed text settle into the URL (?q=fav) before the command runs.
  await expect(browser).toHaveURL(/\?q=fav$/);
  await search.press("Enter");
  await expect(screen.getByPlaceholder("Search favorites...")).toBeVisible();
  expect(await pathOf(browser.url())).toBe("/favorites");
  // Back returns to Everything without the command left in the search.
  await browser.back();
  await expect(screen.getByRole("combobox")).toHaveValue("");
  expect(await pathOf(browser.url())).toBe("/");
  await browser.forward();
  await expect(screen.getByPlaceholder("Search favorites...")).toBeVisible();

  // The open view's own command goes back to Everything.
  await screen.getByRole("combobox").fill("favorites");
  await screen.getByRole("combobox").press("Enter");
  await expect(screen.getByPlaceholder("Search for anything...")).toBeVisible();
  expect(await pathOf(browser.url())).toBe("/");
});

test("the collapsed sidebar is remembered across reloads", async ({
  browser,
  screen,
  webAccount: _signedIn,
}) => {
  await gotoApp(browser, "/");
  await expectVault({ browser, screen });
  const sidebar = browser.locator('[data-slot="sidebar"][data-state]');
  await expect(sidebar).toHaveAttribute("data-state", "expanded");
  await screen.getByRole("button", "Toggle sidebar").click();
  await expect(sidebar).toHaveAttribute("data-state", "collapsed");
  await browser.reload();
  await expect(sidebar).toHaveAttribute("data-state", "collapsed");
  // Collapsed items keep their names for screen readers and tooltips.
  await screen.getByRole("link", "Trash").click();
  await expect(screen.getByPlaceholder("Search Trash...")).toBeVisible();
});

test("on a phone the sidebar is a drawer that closes after navigating", async ({
  browser,
  screen,
  webAccount: _signedIn,
}) => {
  await browser.setViewport({ width: 390, height: 844 });
  await gotoApp(browser, "/");
  await expectVault({ browser, screen });
  const drawer = browser.locator('[data-mobile="true"]');
  await screen.getByRole("button", "Toggle sidebar").click();
  await expect(drawer).toBeVisible();
  await browser.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);

  await screen.getByRole("button", "Toggle sidebar").click();
  await drawer.getByRole("link", "Archive").click();
  await expect(drawer).toHaveCount(0);
  await expect(screen.getByPlaceholder("Search the archive...")).toBeVisible();
});
