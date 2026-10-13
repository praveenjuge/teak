import { expectVault, gotoApp } from "../helpers/app";
import { expect, test } from "./fixtures";

// Folders from the sidebar: create one, add cards to it from a selection,
// open it, rename it, then delete it and bring it back with Undo. A fresh
// account starts with no folders and three welcome cards.
const FIRST_CARD = "The best way to predict the future";
const SECOND_CARD = "Welcome to Teak!";

const pathOf = async (url: Promise<string>) => new URL(await url).pathname;

test("create a folder, fill it from a selection, rename and delete it", async ({
  browser,
  screen,
  webAccount: _signedIn,
}) => {
  await gotoApp(browser, "/");
  await expectVault({ browser, screen });

  // No folders yet: the group offers New folder.
  await screen.getByRole("button", "New folder").first().click();
  const dialog = screen.getByRole("dialog", "New folder");
  await dialog.getByLabel("Name").fill("Reading");
  await dialog.getByRole("button", "Blue").click();
  await dialog.getByRole("button", "Create folder").click();
  await expect(screen.getByRole("link", "Reading")).toBeVisible();

  // Names are unique ignoring case.
  await screen.getByRole("button", "New folder").first().click();
  await screen
    .getByRole("dialog", "New folder")
    .getByLabel("Name")
    .fill("reading");
  await expect(
    screen.getByText("A folder with this name already exists")
  ).toBeVisible();
  await screen.getByRole("button", "Cancel").click();

  // Select two cards and add them through the bulk bar.
  await screen.getByText(FIRST_CARD, { exact: false }).secondaryTap();
  await screen.getByRole("menuitem", "Select", { exact: false }).click();
  await screen.getByText(SECOND_CARD, { exact: false }).click();
  await expect(
    screen.getByText("2 cards selected", { exact: false })
  ).toBeVisible();
  await screen.getByRole("button", "More actions").click();
  await screen.getByRole("menuitem", "Add to folder…").click();
  await screen.getByRole("option", "Reading", { exact: false }).click();
  await expect(
    screen.getByText("Added 2 cards to Reading", { exact: false })
  ).toBeVisible({ timeout: 30_000 });

  // The folder page lists just those cards.
  await screen.getByRole("link", "Reading").click();
  await expect(screen.getByPlaceholder("Search Reading...")).toBeVisible();
  expect(await pathOf(browser.url())).toMatch(/^\/f\//);
  await expect(screen.getByRole("link", "Reading")).toHaveAttribute(
    "aria-current",
    "page"
  );
  await expect(screen.getByText("2 cards")).toBeVisible();
  await expect(screen.getByText(FIRST_CARD, { exact: false })).toBeVisible();
  await expect(screen.getByText(SECOND_CARD, { exact: false })).toBeVisible();

  // Rename from the folder's menu.
  await screen.getByRole("button", "More for Reading").click();
  await screen.getByRole("menuitem", "Rename…").click();
  const rename = screen.getByRole("dialog", "Edit folder");
  await rename.getByLabel("Name").fill("Reading list");
  await rename.getByRole("button", "Save").click();
  await expect(screen.getByRole("link", "Reading list")).toBeVisible();
  await expect(screen.getByPlaceholder("Search Reading list...")).toBeVisible();

  // Deleting the open folder returns to Everything; Undo brings it back
  // with its cards.
  await screen.getByRole("button", "More for Reading list").click();
  await screen.getByRole("menuitem", "Delete").click();
  await expect(
    screen.getByText("Deleted “Reading list”", { exact: false })
  ).toBeVisible();
  await expect(screen.getByPlaceholder("Search for anything...")).toBeVisible();
  expect(await pathOf(browser.url())).toBe("/");
  await screen.getByRole("button", "Undo").click();
  await screen.getByRole("link", "Reading list").click();
  await expect(screen.getByText("2 cards")).toBeVisible();
});
