import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import { gotoApp } from "../helpers/app";
import { expect, test } from "./fixtures";

const ALPHA = "Tagged alpha card";
const BETA = "Tagged beta card";
const GAMMA = "Tagged gamma card";

test("open a tag's cards, then rename, merge and delete it everywhere", async ({
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
  await screen.getByRole("link", "Tags").click();
  await expect(browser).toHaveURL(/\/tags$/);
  await expect(screen.getByRole("link", "Tags")).toHaveAttribute(
    "aria-current",
    "page"
  );
  const tagRow = (name: string) =>
    screen.getByRole("link", `${name}, `, { exact: false });
  const design = tagRow("design");
  await expect(design).toBeVisible({ timeout: 60_000 });
  await expect(tagRow("web")).toBeVisible();

  await screen.getByRole("searchbox", "Find a tag").fill("WE");
  await expect(tagRow("web")).toBeVisible();
  await expect(design).not.toBeVisible();
  await screen.getByRole("searchbox", "Find a tag").fill("");

  await design.click();
  await expect(browser).toHaveURL(/\/\?tag=design$/);
  await expect(
    screen.getByRole("button", "Remove tag filter design")
  ).toBeVisible();
  await expect(screen.getByText(ALPHA)).toBeVisible();
  await expect(screen.getByText(BETA)).toBeVisible();
  await expect(screen.getByText(GAMMA)).not.toBeVisible();

  await screen.getByRole("link", "Tags").click();
  await screen.getByRole("button", "More for design").click();
  await screen.getByRole("menuitem", "Rename…").click();
  const rename = screen.getByRole("dialog", "Rename tag");
  await rename.getByLabel("New name").fill("Design Systems");
  await rename.getByRole("button", "Rename").click();
  await expect(
    screen.getByText("Renamed “design” to “Design Systems”", { exact: false })
  ).toBeVisible({ timeout: 30_000 });
  await expect(tagRow("design systems")).toBeVisible();
  expect(await tagsOf(alpha)).toEqual(["Design Systems", "web"]);

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

  await screen.getByRole("button", "More for design systems").click();
  await screen.getByRole("menuitem", "Delete…").click();
  await screen
    .getByRole("dialog", "Delete “design systems”?")
    .getByRole("button", "Delete tag")
    .click();
  await expect(
    screen.getByText("Deleted “design systems”", { exact: false })
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    screen.getByRole("button", "More for design systems")
  ).not.toBeVisible();
  expect(await tagsOf(alpha)).toBeUndefined();
});
