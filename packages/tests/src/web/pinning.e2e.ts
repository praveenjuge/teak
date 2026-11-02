import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import { gotoApp } from "../helpers/app";
import { expect, test } from "./fixtures";

const run = Date.now();
const FIRST = `Pinboard first ${run}`;
const SECOND = `Pinboard second ${run}`;
const THIRD = `Pinboard third ${run}`;

test("cards pin to a row above Everything, reorder, and leave it when archived", async ({
  browser,
  screen,
  library,
}) => {
  const ids: Record<string, Id<"cards">> = {};
  for (const content of [FIRST, SECOND, THIRD]) {
    const id = await library.client.mutation(api.cards.createCard, {
      content,
      type: "text",
    });
    ids[content] = id;
    library.ids.push(id);
  }
  const pinnedOrder = async () =>
    (await library.client.query(api.cards.getPinnedCards, {})).map(
      (card: { content: string }) => card.content
    );
  const card = (title: string) =>
    screen.getByRole("button", `Text: ${title}`, { exact: false });
  const strip = screen.getByRole("region", "Pinned");
  const press = (key: string) => browser.keyboard.press(key);

  await gotoApp(browser, "/");
  await expect(card(FIRST)).toBeVisible({ timeout: 30_000 });
  await expect(strip).toBeHidden();

  await card(FIRST).focus();
  await press("p");
  await expect(strip.getByRole("button", `Text: ${FIRST}`)).toBeVisible();
  await expect(card(FIRST)).toHaveCount(1);
  await expect.poll(pinnedOrder).toEqual([FIRST]);

  await card(SECOND).secondaryTap();
  await screen.getByRole("menuitem", "Pin to top", { exact: false }).click();
  await expect.poll(pinnedOrder).toEqual([SECOND, FIRST]);

  await strip.getByRole("button", `Text: ${SECOND}`).focus();
  await press("Alt+ArrowRight");
  await expect(strip.getByText("Moved to position 2 of 2.")).toBeAttached();
  await expect(strip.getByRole("button", `Text: ${SECOND}`)).toBeFocused();
  await expect.poll(pinnedOrder).toEqual([FIRST, SECOND]);
  await browser.reload();
  await expect(strip.getByRole("button", `Text: ${SECOND}`)).toBeVisible({
    timeout: 30_000,
  });
  expect(await pinnedOrder()).toEqual([FIRST, SECOND]);

  const search = screen.getByRole("combobox");
  await search.fill(`is:pinned ${run}`);
  await search.press("Enter");
  await expect(strip).toBeHidden();
  await expect(card(FIRST)).toBeVisible({ timeout: 30_000 });
  await expect(card(SECOND)).toBeVisible();
  await expect(card(THIRD)).toBeHidden();

  await gotoApp(browser, "/");
  await strip.getByRole("button", `Text: ${FIRST}`).focus();
  await press("e");
  await expect.poll(pinnedOrder).toEqual([SECOND]);
  await gotoApp(browser, "/archive");
  await card(FIRST).secondaryTap();
  await expect(
    screen.getByRole("menuitem", "Select", { exact: false })
  ).toBeVisible();
  await expect(
    screen.getByRole("menuitem", "Pin to top", { exact: false })
  ).toHaveCount(0);
});

test("a 13th pin is refused with a message", async ({
  browser,
  screen,
  library,
}) => {
  for (let index = 0; index < 13; index += 1) {
    const id = await library.client.mutation(api.cards.createCard, {
      content: `Pin cap ${run} ${index}`,
      type: "text",
    });
    library.ids.push(id);
    if (index < 12) {
      await library.client.mutation(api.cards.setCardPinned, {
        cardId: id,
        pinned: true,
      });
    }
  }
  await gotoApp(browser, "/");
  const extra = screen.getByRole("button", `Text: Pin cap ${run} 12`, {
    exact: false,
  });
  await expect(extra).toBeVisible({ timeout: 30_000 });
  await extra.focus();
  await browser.keyboard.press("p");
  await expect(
    screen.getByText("You can pin up to 12 cards. Unpin one first.")
  ).toBeVisible();
  expect(await library.client.query(api.cards.getPinnedCards, {})).toHaveLength(
    12
  );
});
