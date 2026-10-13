import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import { gotoApp } from "../helpers/app";
import { expect, test } from "./fixtures";

// Tags from the sidebar: the list with counts, filtering by one, then
// renaming, merging and deleting it across every card.
const ALPHA = "Tagged alpha card";
const BETA = "Tagged beta card";
const GAMMA = "Tagged gamma card";

test("filter by a tag, then rename, merge and delete it everywhere", async ({
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
  const alpha = await create(ALPHA, ["Design", "web"]);
  await create(BETA, ["design"]);
  const gamma = await create(GAMMA, ["web"]);
  const tagsOf = async (id: Id<"cards">) =>
    (await library.client.query(api.cards.getCard, { id }))?.tags;

  await gotoApp(browser, "/");
  // Case variants are one tag. The list follows tag changes after a short
  // delay.
  const design = screen.getByRole("button", "design", { exact: true });
  await expect(design).toBeVisible({ timeout: 60_000 });

  // Picking a tag narrows the library and shows it as a removable chip.
  await design.click();
  await expect(browser).toHaveURL(/tag=design/);
  await expect(
    screen.getByRole("button", "Remove tag filter design")
  ).toBeVisible();
  await expect(screen.getByText(ALPHA)).toBeVisible();
  await expect(screen.getByText(BETA)).toBeVisible();
  await expect(screen.getByText(GAMMA)).not.toBeVisible();

  // Rename from the tag's menu; the filter follows the new name.
  await screen.getByRole("button", "More for design").click();
  await screen.getByRole("menuitem", "Rename…").click();
  const rename = screen.getByRole("dialog", "Rename tag");
  await rename.getByLabel("New name").fill("Design Systems");
  await rename.getByRole("button", "Rename").click();
  await expect(
    screen.getByText("Renamed “design” to “Design Systems”", { exact: false })
  ).toBeVisible({ timeout: 30_000 });
  await expect(browser).toHaveURL(/tag=design\+systems/);
  expect(await tagsOf(alpha)).toEqual(["Design Systems", "web"]);

  // Merge "web" into the renamed tag: a card with both keeps one.
  await screen.getByRole("button", "More for web").click();
  await screen.getByRole("menuitem", "Merge into…").click();
  const merge = screen.getByRole("dialog", "Merge “web” into…");
  await merge.getByRole("option", "design systems", { exact: false }).click();
  await merge.getByRole("button", "Merge into “design systems”").click();
  await expect(
    screen.getByText("Merged “web” into “design systems”", { exact: false })
  ).toBeVisible({ timeout: 30_000 });
  expect(await tagsOf(alpha)).toEqual(["Design Systems"]);
  expect(await tagsOf(gamma)).toEqual(["design systems"]);

  // Delete it: the cards are kept and the filter clears.
  await screen.getByRole("button", "More for design systems").click();
  await screen.getByRole("menuitem", "Delete…").click();
  await screen
    .getByRole("dialog", "Delete “design systems”?")
    .getByRole("button", "Delete tag")
    .click();
  await expect(
    screen.getByText("Deleted “design systems”", { exact: false })
  ).toBeVisible({ timeout: 30_000 });
  await expect(browser).not.toHaveURL(/tag=/);
  expect(await tagsOf(alpha)).toBeUndefined();
  await expect(screen.getByText(GAMMA)).toBeVisible();
});
