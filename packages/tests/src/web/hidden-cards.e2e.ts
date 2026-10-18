import { api } from "@teak/convex";
import { gotoApp } from "../helpers/app";
import { expect, generateTestContent, test } from "./fixtures";

test("a secret tag hides a card, Undo brings it back, and #secret shows it", async ({
  browser,
  screen,
  library,
}) => {
  const hidden = generateTestContent("Hidden card");
  const shown = generateTestContent("Shown card");
  const hiddenId = await library.create(hidden);
  await library.create(shown);
  const tagsOf = async () =>
    (await library.client.query(api.cards.getCard, { id: hiddenId }))?.tags;

  await gotoApp(browser, "/");
  const grid = screen.getByRole("main");
  await expect(grid.getByText(hidden)).toBeVisible({ timeout: 30_000 });

  const dialog = await library.open(hiddenId);
  await dialog.getByRole("textbox", "Add a tag").fill("Secret");
  await dialog.getByRole("textbox", "Add a tag").press("Enter");
  await expect(
    screen.getByText("Hidden. Search #secret to see it.")
  ).toBeVisible();
  await expect(dialog.getByText("Hidden", { exact: true })).toBeVisible();
  await expect.poll(tagsOf).toEqual(["secret"]);

  await browser.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(grid.getByText(hidden)).not.toBeVisible();
  await expect(grid.getByText(shown)).toBeVisible();

  await screen.getByRole("button", "Undo").click();
  await expect.poll(tagsOf).toEqual(undefined);
  await expect(grid.getByText(hidden)).toBeVisible();

  await library.client.mutation(api.cards.updateCardField, {
    cardId: hiddenId,
    field: "tags",
    value: ["hidden"],
  });
  await expect(grid.getByText(hidden)).not.toBeVisible();
  const search = screen.getByRole("combobox");
  await search.fill("hidden");
  await search.press("Enter");
  await expect(grid.getByText(shown)).not.toBeVisible();
  await expect(grid.getByText(hidden)).not.toBeVisible();

  await search.fill("#hidden");
  await search.press("Enter");
  await expect(screen.getByRole("button", "Remove tag hidden")).toBeVisible();
  await expect(grid.getByText(hidden)).toBeVisible();
  await expect(grid.getByText(shown)).not.toBeVisible();
});
