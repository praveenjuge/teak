import { api } from "@teak/convex";
import { gotoApp } from "../helpers/app";
import { expect, test } from "./fixtures";

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

  const card = (title: string) =>
    screen.getByRole("button", `: ${title}`, { exact: false });

  await gotoApp(browser, "/");
  const search = screen.getByRole("combobox");
  await expect(card(REPO)).toBeVisible({ timeout: 30_000 });

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
  await expect(card(REPO)).toBeVisible();
  await expect(card(NOTES)).toBeVisible();
  await expect(card(ELSEWHERE)).not.toBeVisible();
  await expect(browser).toHaveURL(/q=site%3Aqualifiers\.example/);

  await search.fill("tag:qualified");
  await search.press("Enter");
  await expect(
    screen.getByRole("button", "Remove tag qualified")
  ).toBeVisible();
  await expect(card(REPO)).toBeVisible();
  await expect(card(NOTES)).not.toBeVisible();

  await search.fill("tag:qual");
  await expect(screen.getByRole("listbox")).toBeVisible();
  await search.press("Escape");
  await expect(screen.getByRole("listbox")).not.toBeVisible();
  await expect(search).toHaveValue("tag:qual");
  await search.fill("");

  await browser.reload();
  await expect(
    screen.getByRole("button", "Remove site qualifiers.example")
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    screen.getByRole("button", "Remove tag qualified")
  ).toBeVisible();
  await expect(card(REPO)).toBeVisible();

  await screen.getByRole("button", "Remove site qualifiers.example").click();
  await expect(card(ELSEWHERE)).toBeVisible();
  await expect(card(REPO)).toBeVisible();
  await screen.getByRole("button", "Remove tag qualified").click();

  await search.fill('folder:"qualifier sh');
  await screen.getByRole("option", "Qualifier shelf", { exact: false }).click();
  await expect(
    screen.getByRole("button", "Remove folder Qualifier shelf")
  ).toBeVisible();
  await expect(card(FILED)).toBeVisible();
  await expect(card(REPO)).not.toBeVisible();
  await search.fill("folder:nowhere");
  await search.press("Enter");
  await expect(
    screen.getByText("No folder named nowhere", { exact: false })
  ).toBeVisible();
  await expect(card(FILED)).not.toBeVisible();
});

test("text: is a chip that survives a reload and matches only image text", async ({
  browser,
  screen,
  library,
}) => {
  const id = await library.client.mutation(api.cards.createCard, {
    content: "A note about the total due on invoice 4411",
    type: "text",
  });
  library.ids.push(id);

  await gotoApp(browser, "/");
  const search = screen.getByRole("combobox");
  await search.fill("te");
  await expect(
    screen.getByRole("option", "text:", { exact: false })
  ).toBeVisible({ timeout: 30_000 });
  await search.fill('text:"total due"');
  await search.press("Enter");
  const chip = screen.getByRole("button", "Remove text in image total due");
  await expect(chip).toBeVisible();
  await expect(browser).toHaveURL(/q=text%3A%22total(\+|%20)due%22/);
  await expect(screen.getByText(/nothing found/i)).toBeVisible();

  await browser.reload();
  await expect(chip).toBeVisible({ timeout: 30_000 });
  await chip.click();
  await search.fill("total due");
  await search.press("Enter");
  await expect(
    screen.getByRole("button", ": A note about the total due", {
      exact: false,
    })
  ).toBeVisible({ timeout: 30_000 });
});
