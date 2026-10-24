import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import type { Screen } from "e2e";
import { gotoApp } from "../helpers/app";
import { type Browser, describe } from "../helpers/test";
import { expect, test } from "./fixtures";

interface ImportedCard {
  _id: Id<"cards">;
  content?: string;
  createdAt?: number;
  notes?: string;
  tags?: string[];
  url?: string;
}

// Paths are relative to packages/tests, the e2e project root.
const FIXTURES = "src/web/import-fixtures";

const importCsv = async (
  browser: Browser,
  screen: Screen,
  fileName: string
) => {
  await gotoApp(browser, "/settings");
  await screen.getByRole("button", "Manage import and export").click();
  const dialog = screen.getByRole("dialog", "Manage data");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("combobox", "Import from").click();
  await screen.getByRole("option", "CSV file").click();
  await expect(
    dialog.getByText(
      "A CSV with a header row. Teak reads url, title, tags, folder, note and created columns.",
      { exact: false }
    )
  ).toBeVisible();
  await browser
    .locator('input[type="file"][accept=".csv"]')
    .setInputFiles(`${FIXTURES}/${fileName}`);
  await expect(dialog.getByText(fileName)).toBeVisible();
  await dialog.getByRole("button", "Start import").click();
  return dialog;
};

describe("Importing a CSV file", () => {
  test("imports every row of a CSV as a link with its title, tags, folder, note and date", async ({
    browser,
    screen,
    library,
  }) => {
    const dialog = await importCsv(browser, screen, "full.csv");
    await expect(
      dialog.getByText("Last import: 4 created, 0 skipped", { exact: false })
    ).toBeVisible({ timeout: 120_000 });

    const imported = (
      (await library.client.query(api.cards.getCards, {
        limit: 100,
      })) as ImportedCard[]
    ).filter((card) => card.url?.startsWith("https://example.com/full/"));
    library.ids.push(...imported.map((card) => card._id));
    const first = imported.find(
      (card) => card.url === "https://example.com/full/one"
    );
    expect(imported).toHaveLength(4);
    expect(first?.content).toBe("First link");
    expect(first?.tags).toEqual(["design", "type"]);
    expect(first?.notes).toBe("A note");
    expect(first?.createdAt).toBe(Date.parse("2024-05-01"));

    const folders = (await library.client.query(
      api.folders.listFolders,
      {}
    )) as { name: string }[];
    expect(folders.map((folder) => folder.name)).toEqual(
      expect.arrayContaining(["Work / Design", "Reading"])
    );
  });

  test("a CSV without a url column stops with a message saying how to fix it", async ({
    browser,
    screen,
    webAccount: _signedIn,
  }) => {
    const dialog = await importCsv(browser, screen, "no-url.csv");
    await expect(dialog.getByText("Import stopped")).toBeVisible({
      timeout: 120_000,
    });
    await expect(
      dialog.getByText(
        "This CSV has no url column. Add a header row with a url (or link) column."
      )
    ).toBeVisible();
  });
});
