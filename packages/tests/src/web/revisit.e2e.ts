import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import { gotoApp } from "../helpers/app";
import { expect, test } from "./fixtures";

const TAG = "revisit-pass";
const VISIBLE = 22;
const PAGE_WITHOUT_CARD_QUERIES = "/settings";

const paramOf = async (url: Promise<string>, name: string) =>
  new URL(await url).searchParams.get(name);

test("Revisit deals 20 cards to keep or archive, and 20 more without repeats", {
  timeout: 240_000,
}, async ({
  browser,
  screen,
  library,
}) => {
  await gotoApp(browser, PAGE_WITHOUT_CARD_QUERIES);
  const idsByText = new Map<string, Id<"cards">>();
  for (let index = 0; index < VISIBLE; index++) {
    const content = `Revisit card ${String(index).padStart(2, "0")}`;
    const id = await library.client.mutation(api.cards.createCard, {
      content,
      type: "text",
      tags: [TAG],
    });
    library.ids.push(id);
    idsByText.set(content, id);
  }
  library.ids.push(
    await library.client.mutation(api.cards.createCard, {
      content: "Revisit hidden card",
      type: "text",
      tags: [TAG, "secret"],
    })
  );
  await library.waitForProcessing(idsByText.values());
  const isArchived = async (text: string) => {
    const id = idsByText.get(text);
    return id
      ? (await library.client.query(api.cards.getCard, { id }))?.isArchived ===
          true
      : undefined;
  };
  const deck = screen.getByRole("dialog", "Revisit");
  const progress = (text: string) => deck.getByText(text, { exact: true });
  const current = () =>
    browser.evaluate(
      () =>
        document
          .querySelector(
            '[data-revisit-deck] main button[aria-label^="Open details"]'
          )
          ?.textContent?.trim() ?? ""
    );
  const press = (key: string) => browser.keyboard.press(key);

  await gotoApp(browser, `/?tag=${TAG}`);
  await expect(
    screen.getByRole("button", "Text: Revisit card 21", { exact: false })
  ).toBeVisible({ timeout: 30_000 });

  await screen.getByRole("button", "View", { exact: false }).click();
  await screen.getByRole("menuitemradio", "Revisit").click();
  await expect.poll(() => paramOf(browser.url(), "sort")).toBe("revisit");
  const seed = await paramOf(browser.url(), "seed");
  expect(seed).toMatch(/^\d+$/);
  await expect(progress("1 of 20")).toBeVisible({ timeout: 30_000 });
  const first = await current();
  expect(first).toMatch(/^Revisit card \d\d$/);

  await browser.reload();
  await expect(progress("1 of 20")).toBeVisible({ timeout: 30_000 });
  expect(await current()).toBe(first);

  await press("ArrowLeft");
  await expect(screen.getByText("Archived 1 card")).toBeVisible();
  await expect(progress("2 of 20")).toBeVisible();
  await expect.poll(() => isArchived(first)).toBe(true);
  await press("z");
  await expect(progress("1 of 20")).toBeVisible();
  expect(await current()).toBe(first);
  await expect.poll(() => isArchived(first)).toBe(false);

  await press("ArrowLeft");
  await expect(progress("2 of 20")).toBeVisible();
  const second = await current();
  await expect.poll(() => isArchived(first)).toBe(true);
  await browser.reload();
  await expect(progress("1 of 20")).toBeVisible({ timeout: 30_000 });
  expect(await current()).toBe(second);

  const seen: string[] = [];
  for (let position = 1; position <= 20; position++) {
    await expect(progress(`${position} of 20`)).toBeVisible();
    seen.push(await current());
    await press("ArrowRight");
  }
  await expect(deck.getByText("All caught up")).toBeVisible();
  await deck.getByRole("button", "Revisit 20 more").click();
  await expect(progress("1 of 1")).toBeVisible({ timeout: 30_000 });
  seen.push(await current());
  await press("ArrowRight");
  await expect(deck.getByRole("button", "Start over")).toBeVisible();
  expect(new Set(seen).size).toBe(VISIBLE - 1);
  expect(seen).not.toContain(first);
  expect(seen.some((text) => text.includes("hidden"))).toBe(false);

  await press("Escape");
  await expect(deck).toBeHidden();
  await expect.poll(() => paramOf(browser.url(), "sort")).toBeNull();
  await expect(
    screen.getByRole("button", `Text: ${second}`, { exact: false })
  ).toBeVisible();
});

test("Esc goes Back to the order Revisit was picked from", async ({
  browser,
  screen,
  library,
}) => {
  library.ids.push(
    await library.client.mutation(api.cards.createCard, {
      content: "Revisit back card",
      type: "text",
      tags: [`${TAG}-back`],
    })
  );
  await gotoApp(browser, `/?tag=${TAG}-back&sort=oldest`);
  await expect(
    screen.getByRole("button", "Text: Revisit back card", { exact: false })
  ).toBeVisible({ timeout: 30_000 });
  await screen.getByRole("button", "View", { exact: false }).click();
  await screen.getByRole("menuitemradio", "Revisit").click();
  const deck = screen.getByRole("dialog", "Revisit");
  await expect(deck.getByText("1 of 1", { exact: true })).toBeVisible({
    timeout: 30_000,
  });

  await browser.keyboard.press("Escape");
  await expect(deck).toBeHidden();
  await expect.poll(() => paramOf(browser.url(), "sort")).toBe("oldest");
  await browser.forward();
  await expect(deck.getByText("1 of 1", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
});

test("Esc after a card's details still returns to the order Revisit was picked from", async ({
  browser,
  screen,
  library,
}) => {
  library.ids.push(
    await library.client.mutation(api.cards.createCard, {
      content: "Revisit details card",
      type: "text",
      tags: [`${TAG}-details`],
    })
  );
  await gotoApp(browser, `/?tag=${TAG}-details&sort=oldest`);
  await expect(
    screen.getByRole("button", "Text: Revisit details card", { exact: false })
  ).toBeVisible({ timeout: 30_000 });
  await screen.getByRole("button", "View", { exact: false }).click();
  await screen.getByRole("menuitemradio", "Revisit").click();
  const deck = screen.getByRole("dialog", "Revisit");
  await expect(deck.getByText("1 of 1", { exact: true })).toBeVisible({
    timeout: 30_000,
  });

  await browser.keyboard.press(" ");
  await expect.poll(() => paramOf(browser.url(), "card")).not.toBeNull();
  await browser.keyboard.press("Escape");
  await expect.poll(() => paramOf(browser.url(), "card")).toBeNull();
  await expect(deck.getByText("1 of 1", { exact: true })).toBeVisible();

  await browser.keyboard.press("Escape");
  await expect(deck).toBeHidden();
  await expect.poll(() => paramOf(browser.url(), "sort")).toBe("oldest");
});
