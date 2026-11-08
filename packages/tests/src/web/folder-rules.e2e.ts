import {
  expectVault,
  fillAndSubmitTextCard,
  type gotoApp,
} from "../helpers/app";
import { expect, test } from "./fixtures";

const toast = (browser: Parameters<typeof gotoApp>[0], text: string | RegExp) =>
  browser.locator("[data-sonner-toast]").filter({ hasText: text });

test("folder rules tag a folder's cards with Undo, and file new matching cards", async ({
  browser,
  screen,
  webAccount: _signedIn,
}) => {
  // Signing up lands on the library; reloading it here can briefly show two
  // composers while the page swaps.
  await expectVault({ browser, screen });

  // A folder without rules shows only "Add a rule"; tags saved there go on
  // the cards already in it, and Undo takes them back.
  await screen.getByRole("link", "Start here").click();
  await screen.getByRole("button", "Edit folder").click();
  const dialog = screen.getByRole("dialog", "Edit folder");
  await expect(dialog.getByLabel("Add these tags")).toHaveCount(0);
  await dialog.getByRole("button", "Add a rule").click();
  await expect(dialog.getByLabel("Add these tags")).toBeFocused();
  await dialog.getByLabel("Add these tags").fill("onboarding");
  await dialog.getByRole("button", "Save").click();
  const updated = toast(browser, /Updated \d+ cards in Start here/);
  await expect(updated).toBeVisible({ timeout: 60_000 });
  await updated.getByRole("button", "Undo").click();
  await expect(
    toast(browser, "Undid the rules run for Start here")
  ).toBeVisible({ timeout: 60_000 });

  // A search that can't be a rule is refused before saving.
  await screen.getByRole("button", "Edit folder").click();
  await expect(dialog.getByRole("button", "Remove onboarding")).toBeVisible();
  await dialog.getByLabel("Auto-file cards that match").fill("mood:calm");
  await expect(
    dialog.getByText("Folder rules can't use like: or mood:", { exact: false })
  ).toBeVisible();
  await expect(dialog.getByRole("button", "Save")).toBeDisabled();
  await dialog.getByRole("button", "Cancel").click();

  // An auto-file rule files a note saved later, once Teak has read it, and
  // gives it the folder's tags.
  await screen.getByRole("button", "New folder").first().click();
  await screen.getByLabel("New folder name").fill("Birds");
  await screen.getByLabel("New folder name").press("Enter");
  await screen.getByRole("button", "More for Birds").click();
  await screen.getByRole("menuitem", "Edit…").click();
  await dialog.getByRole("button", "Add a rule").click();
  await dialog.getByLabel("Add these tags").fill("birding");
  await dialog.getByLabel("Add these tags").press("Enter");
  await dialog.getByLabel("Auto-file cards that match").fill("kestrel");
  await expect(dialog.getByText("No cards match")).toBeVisible();
  await dialog.getByRole("button", "Save").click();
  await expect(dialog).toHaveCount(0);

  await screen.getByRole("link", "Everything").click();
  await expectVault({ browser, screen });
  await fillAndSubmitTextCard(
    { browser, screen },
    "A kestrel hovering over the meadow"
  );
  await screen.getByRole("link", "Birds").click();

  // The new card shows on Everything too, so its text can match before
  // the folder page loads; wait for the folder's own search box first.
  await expect(screen.getByRole("combobox", "Search Birds")).toBeVisible({
    timeout: 30_000,
  });
  // The card is a button named by its type and text; clicking the bare text
  // can resolve to a hidden copy of it while the list settles.
  const filed = screen.getByRole(
    "button",
    "Text: A kestrel hovering over the meadow"
  );
  await expect(filed).toBeVisible({ timeout: 90_000 });
  await filed.click();
  await expect(
    screen.getByRole("button", "birding", { exact: true })
  ).toBeVisible();
});
