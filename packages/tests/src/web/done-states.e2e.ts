import { api } from "@teak/convex";
import { gotoApp } from "../helpers/app";
import { expect, test } from "./fixtures";

// The local stack can't fetch pages, so a new link has no category yet: it
// reads "Mark as done" and is never on the to-do list.
test("a link is marked done from its card, Undo clears it, and is:done finds it", async ({
  browser,
  screen,
  library,
}) => {
  const url = `https://example.com/done-${Date.now()}`;
  const cardId = await library.client.mutation(api.cards.createCard, {
    content: url,
  });
  library.ids.push(cardId);
  const completedAt = async () =>
    (await library.client.query(api.cards.getCard, { id: cardId }))
      ?.completedAt;

  await gotoApp(browser, `/?card=${cardId}`);
  const dialog = screen.getByRole("dialog");
  await dialog.getByRole("button", "Mark as done").click();
  await expect(screen.getByText("Marked as done")).toBeVisible();
  await expect(dialog.getByRole("button", "Done")).toBeVisible();

  await browser.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await screen.getByRole("button", "Undo").click();
  await expect.poll(completedAt).toBeUndefined();

  await gotoApp(browser, `/?card=${cardId}`);
  await dialog.getByRole("button", "Mark as done").click();
  await expect.poll(completedAt).toEqual(expect.any(Number));
  await browser.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  const grid = screen.getByRole("main");
  const search = screen.getByRole("combobox");
  await search.fill("is:done");
  await search.press("Enter");
  await expect(grid.getByRole("img", "Marked as done")).toBeVisible({
    timeout: 30_000,
  });

  await search.fill("is:todo");
  await search.press("Enter");
  await expect(grid.getByText("Nothing left to do.")).toBeVisible();
});

test("Undo on the toast works while the card is still open", async ({
  browser,
  screen,
  library,
}) => {
  const cardId = await library.client.mutation(api.cards.createCard, {
    content: `https://example.com/undo-open-${Date.now()}`,
  });
  library.ids.push(cardId);
  const completedAt = async () =>
    (await library.client.query(api.cards.getCard, { id: cardId }))
      ?.completedAt;

  await gotoApp(browser, `/?card=${cardId}`);
  const dialog = screen.getByRole("dialog");
  await dialog.getByRole("button", "Mark as done").click();
  await expect.poll(completedAt).toEqual(expect.any(Number));

  await screen.getByRole("button", "Undo").click();

  await expect.poll(completedAt).toBeUndefined();
  await expect(dialog.getByRole("button", "Mark as done")).toBeVisible();
});

test("an empty to-do smart folder says there is nothing left to do", async ({
  browser,
  screen,
  library,
}) => {
  const folder = await library.client.mutation(api.folders.createFolder, {
    name: `Left to read ${Date.now()}`,
    kind: "smart",
    query: "is:todo",
  });
  try {
    await gotoApp(browser, `/f/${folder._id}`);
    const grid = screen.getByRole("main");
    await expect(grid.getByText("Nothing left to do.")).toBeVisible({
      timeout: 30_000,
    });
  } finally {
    await library.client.mutation(api.folders.deleteFolder, {
      folderId: folder._id,
    });
  }
});
