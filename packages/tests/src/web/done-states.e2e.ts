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
  const completedAt = async () =>
    (await library.client.query(api.cards.getCard, { id: cardId }))
      ?.completedAt;

  await gotoApp(browser, `/?card=${cardId}`);
  const dialog = screen.getByRole("dialog");
  await dialog.getByRole("button", "Mark as done").click();
  await expect(screen.getByText("Marked as done")).toBeVisible();
  await expect(dialog.getByRole("button", "Done")).toBeVisible();

  // The open dialog keeps the page behind it inert; Undo waits there.
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

  // A link with no category is never on the to-do list.
  await search.fill("is:todo");
  await search.press("Enter");
  await expect(grid.getByText("Nothing left to do.")).toBeVisible();

  await library.client.mutation(api.cards.permanentDeleteCard, {
    id: cardId,
  });
});
