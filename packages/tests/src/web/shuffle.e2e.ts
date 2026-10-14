import { api } from "@teak/convex";
import { gotoApp } from "../helpers/app";
import { expect, test } from "./fixtures";

// Shuffle from the sort menu: the seed lives in the URL, so a reload shows
// the same order; Reshuffle picks a new one and Back returns to the old.
// The cards share a tag and the page shows only that tag.
const TAG = "shuffle-pass";
const COUNT = 12;

const seedOf = async (url: Promise<string>) =>
  new URL(await url).searchParams.get("seed");

test("shuffle keeps its order in the URL", async ({
  browser,
  screen,
  library,
}) => {
  for (let index = 0; index < COUNT; index++) {
    library.ids.push(
      await library.client.mutation(api.cards.createCard, {
        content: `Shuffle card ${String(index).padStart(2, "0")}`,
        type: "text",
        tags: [TAG],
      })
    );
  }
  const card = (index: number) =>
    screen.getByRole(
      "button",
      `Text: Shuffle card ${String(index).padStart(2, "0")}`,
      { exact: false }
    );
  // The grid's cards in page order, once all of them are shown.
  const order = async () => {
    await expect
      .poll(() =>
        browser.evaluate(
          () => document.querySelectorAll("[data-card-id]").length
        )
      )
      .toBe(COUNT);
    return browser.evaluate(() =>
      [...document.querySelectorAll("[data-card-id]")]
        .map((element) => element.getAttribute("data-card-id"))
        .join(",")
    );
  };
  const openSortMenu = () =>
    screen.getByRole("button", "View", { exact: false }).click();

  await gotoApp(browser, `/?tag=${TAG}`);
  await expect(card(0)).toBeVisible({ timeout: 30_000 });
  const newest = await order();

  // Choosing Shuffle puts a seed in the URL and shows the Reshuffle button.
  await openSortMenu();
  await screen.getByRole("menuitemradio", "Shuffle").click();
  await expect.poll(() => seedOf(browser.url())).toMatch(/^\d+$/);
  const firstSeed = await seedOf(browser.url());
  const reshuffle = screen.getByRole("button", "Reshuffle");
  await expect(reshuffle).toBeVisible();
  await expect.poll(order).not.toBe(newest);
  const firstOrder = await order();

  // The same seed gives the same order after a reload.
  await browser.reload();
  await expect(card(0)).toBeVisible({ timeout: 30_000 });
  expect(await order()).toBe(firstOrder);

  // Reshuffle picks a new seed; Back returns to the previous order.
  await reshuffle.click();
  await expect.poll(() => seedOf(browser.url())).not.toBe(firstSeed);
  await expect.poll(order).not.toBe(firstOrder);
  await browser.back();
  await expect.poll(() => seedOf(browser.url())).toBe(firstSeed);
  await expect.poll(order).toBe(firstOrder);

  // Back to a date order: no seed, no Reshuffle.
  await openSortMenu();
  await screen.getByRole("menuitemradio", "Newest first").click();
  await expect.poll(() => seedOf(browser.url())).toBeNull();
  await expect(reshuffle).toBeHidden();
  await expect.poll(order).toBe(newest);
});
