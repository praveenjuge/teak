import { api } from "@teak/convex";
import { gotoApp } from "../helpers/app";
import { expect, test } from "./fixtures";

// Search qualifiers: suggestions turn `site:`, `tag:` and `folder:` into
// chips, the URL keeps the search, and a reload or Back restores it.
const REPO = "Qualifier repo on the site";
const NOTES = "Qualifier notes on the www host";
const ELSEWHERE = "Qualifier link elsewhere";
const FILED = "Qualifier text in a folder";

test("suggestions turn qualifiers into chips that survive a reload", async ({
  browser,
  screen,
  library,
}) => {
  const create = async (
    content: string,
    title: string,
    extra: { tags?: string[]; type?: "link" | "text"; url?: string } = {}
  ) => {
    const id = await library.client.mutation(api.cards.createCard, {
      content: extra.url ?? content,
      type: extra.type ?? "text",
      url: extra.url,
      tags: extra.tags,
    });
    library.ids.push(id);
    if (extra.type === "link") {
      await library.client.mutation(api.cards.updateCardField, {
        cardId: id,
        field: "metadataTitle",
        value: title,
      });
    }
    return id;
  };
  await create(REPO, REPO, {
    type: "link",
    url: "https://qualifiers.example/repo",
    tags: ["Qualified"],
  });
  await create(NOTES, NOTES, {
    type: "link",
    url: "https://WWW.qualifiers.example/notes",
  });
  await create(ELSEWHERE, ELSEWHERE, {
    type: "link",
    url: "https://elsewhere.example/page",
    tags: ["qualified"],
  });
  const filed = await create(FILED, FILED);
  const folder = await library.client.mutation(api.folders.createFolder, {
    name: "Qualifier shelf",
  });
  await library.client.mutation(api.folders.setCardFolders, {
    cardId: filed,
    folderIds: [folder._id],
  });

  await gotoApp(browser, "/");
  const search = screen.getByRole("combobox");
  await expect(screen.getByText(REPO)).toBeVisible({ timeout: 30_000 });

  // A key, then a site from the list: www. and capitals are the same site.
  await search.fill("si");
  await expect(
    screen.getByRole("option", "site:", { exact: false })
  ).toBeVisible();
  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(search).toHaveValue("site:");
  await search.pressSequentially("qualif");
  await screen
    .getByRole("option", "qualifiers.example", { exact: false })
    .click();
  await expect(
    screen.getByRole("button", "Remove site qualifiers.example")
  ).toBeVisible();
  await expect(search).toHaveValue("");
  await expect(screen.getByText(REPO)).toBeVisible();
  await expect(screen.getByText(NOTES)).toBeVisible();
  await expect(screen.getByText(ELSEWHERE)).not.toBeVisible();
  await expect(browser).toHaveURL(/q=site%3Aqualifiers\.example/);

  // A typed tag qualifier becomes a chip on Enter; tags ignore case.
  await search.fill("tag:qualified");
  await search.press("Enter");
  await expect(
    screen.getByRole("button", "Remove tag qualified")
  ).toBeVisible();
  await expect(screen.getByText(REPO)).toBeVisible();
  await expect(screen.getByText(NOTES)).not.toBeVisible();

  // Escape closes the suggestions and keeps what was typed.
  await search.fill("tag:qual");
  await expect(screen.getByRole("listbox")).toBeVisible();
  await search.press("Escape");
  await expect(screen.getByRole("listbox")).not.toBeVisible();
  await expect(search).toHaveValue("tag:qual");
  await search.fill("");

  // The URL holds the search, so a reload shows the same chips.
  await browser.reload();
  await expect(
    screen.getByRole("button", "Remove site qualifiers.example")
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    screen.getByRole("button", "Remove tag qualified")
  ).toBeVisible();
  await expect(screen.getByText(REPO)).toBeVisible();

  // Removing a chip widens the search again.
  await screen.getByRole("button", "Remove site qualifiers.example").click();
  await expect(screen.getByText(ELSEWHERE)).toBeVisible();
  await expect(screen.getByText(REPO)).toBeVisible();
  await screen.getByRole("button", "Remove tag qualified").click();

  // folder: picks a folder by name; an unknown name matches nothing.
  await search.fill('folder:"qualifier sh');
  await screen.getByRole("option", "Qualifier shelf", { exact: false }).click();
  await expect(
    screen.getByRole("button", "Remove folder Qualifier shelf")
  ).toBeVisible();
  await expect(screen.getByText(FILED)).toBeVisible();
  await expect(screen.getByText(REPO)).not.toBeVisible();
  await search.fill("folder:nowhere");
  await search.press("Enter");
  await expect(
    screen.getByText("No folder named nowhere", { exact: false })
  ).toBeVisible();
  await expect(screen.getByText(FILED)).not.toBeVisible();
});
