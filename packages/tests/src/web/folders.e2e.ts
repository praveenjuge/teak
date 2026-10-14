import { api } from "@teak/convex";
import { expectVault, gotoApp } from "../helpers/app";
import { expect, test } from "./fixtures";

// Folders from the sidebar: create one, add cards to it from a selection,
// open it, rename it, then delete it and bring it back with Undo. A fresh
// account starts with the getting-started cards in a Start here folder.
const FIRST_CARD = "Good design is as little design as possible";
const SECOND_CARD = "Welcome to Teak, a home for everything";

const pathOf = async (url: Promise<string>) => new URL(await url).pathname;

test("create a folder, fill it from a selection, rename and delete it", async ({
  browser,
  screen,
  webAccount: _signedIn,
}) => {
  await gotoApp(browser, "/");
  await expectVault({ browser, screen });

  // New folder, beside the Folders heading, is named in place.
  await screen.getByRole("button", "New folder").first().click();
  await screen.getByLabel("New folder name").fill("Reading");
  await screen.getByLabel("New folder name").press("Enter");
  await expect(screen.getByRole("link", "Reading")).toBeVisible();

  // Names are unique ignoring case; Escape leaves the row.
  await screen.getByRole("button", "New folder").first().click();
  await screen.getByLabel("New folder name").fill("reading");
  await expect(
    screen.getByText("A folder with this name already exists")
  ).toBeVisible();
  await screen.getByLabel("New folder name").press("Escape");
  await expect(screen.getByLabel("New folder name")).toHaveCount(0);

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
  await expect(screen.getByPlaceholder("Search Reading")).toBeVisible();
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
  await expect(screen.getByPlaceholder("Search Reading list")).toBeVisible();

  // Deleting the open folder returns to Everything; Undo brings it back
  // with its cards.
  await screen.getByRole("button", "More for Reading list").click();
  await screen.getByRole("menuitem", "Delete").click();
  await expect(
    screen.getByText("Deleted “Reading list”", { exact: false })
  ).toBeVisible();
  // The deleted folder's page stays mounted but hidden, so check the URL and
  // the sidebar rather than the search placeholder both pages share.
  await expect(browser).toHaveURL(/\/$/);
  await expect(screen.getByRole("link", "Everything")).toHaveAttribute(
    "aria-current",
    "page"
  );
  await browser
    .locator("[data-sonner-toast]")
    .filter({ hasText: "Deleted “Reading list”" })
    .getByRole("button", "Undo")
    .click();
  await screen.getByRole("link", "Reading list").click();
  await expect(screen.getByText("2 cards")).toBeVisible();
});

test("save a search as a smart folder; a card saved later shows up live", async ({
  browser,
  screen,
  library,
}) => {
  const create = async (content: string, tags: string[]) => {
    const id = await library.client.mutation(api.cards.createCard, {
      content,
      type: "text",
      tags,
    });
    library.ids.push(id);
    return id;
  };
  await create("Smart folder first match", ["smartfolder"]);
  await create("Smart folder other card", ["elsewhere"]);

  await gotoApp(browser, "/?q=tag%3Asmartfolder");
  await expect(
    screen.getByText("Smart folder first match", { exact: false })
  ).toBeVisible({ timeout: 30_000 });

  // Saving is in the View menu while there is a search to keep.
  await screen.getByRole("button", /^View/).click();
  await screen.getByRole("menuitem", "Save as smart folder…").click();
  const save = screen.getByRole("dialog", "Save as smart folder");
  await expect(save.getByLabel("Search", { exact: true })).toHaveValue(
    "tag:smartfolder"
  );
  await save.getByLabel("Name").fill("Smart picks");
  await save.getByRole("button", "Save smart folder").click();
  await expect(
    screen.getByText("Saved “Smart picks”", { exact: false })
  ).toBeVisible();

  // Its view shows what the search matches, and the search as chips.
  await screen.getByRole("link", "Smart picks").click();
  await expect(screen.getByPlaceholder("Search Smart picks")).toBeVisible();
  expect(await pathOf(browser.url())).toMatch(/^\/f\//);
  await expect(
    screen.getByText("Smart folder first match", { exact: false })
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    screen.getByText("Smart folder other card", { exact: false })
  ).not.toBeVisible();

  // A matching card saved elsewhere appears without a reload.
  await create("Smart folder live match", ["smartfolder"]);
  await expect(
    screen.getByText("Smart folder live match", { exact: false })
  ).toBeVisible({ timeout: 30_000 });

  // Cards can't be put in a smart folder: the picker never lists it.
  await screen
    .getByText("Smart folder live match", { exact: false })
    .secondaryTap();
  await screen.getByRole("menuitem", "Select", { exact: false }).click();
  await screen.getByRole("button", "More actions").click();
  await expect(
    screen.getByRole("menuitem", "Remove from Smart picks")
  ).not.toBeVisible();
  await screen.getByRole("menuitem", "Add to folder…").click();
  await expect(
    screen.getByRole("option", "Smart picks", { exact: false })
  ).not.toBeVisible();
  await screen.getByLabel("Search folders").press("Escape");
  await screen.getByRole("button", "Cancel selection").click();

  // Editing the search to match nothing shows the empty state.
  await screen.getByRole("button", "Edit search").first().click();
  const edit = screen.getByRole("dialog", "Edit smart folder");
  // A search still being typed only disables Save.
  await edit.getByLabel("Search", { exact: true }).fill("folder:");
  await expect(edit.getByRole("button", "Save")).toBeDisabled();
  await expect(edit.getByRole("alert")).not.toBeVisible();
  await edit.getByLabel("Search", { exact: true }).fill("tag:nothing-here");
  await edit.getByRole("button", "Save").click();
  await expect(
    screen.getByText("No cards match this smart folder.")
  ).toBeVisible({ timeout: 30_000 });
});
