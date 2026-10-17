import { api } from "@teak/convex";
import { gotoApp } from "../helpers/app";
import { expect, test } from "./fixtures";

const TAG = "revisit-pass";
const VISIBLE = 22;

const paramOf = async (url: Promise<string>, name: string) =>
  new URL(await url).searchParams.get(name);

test("Revisit deals 20 cards to keep or archive, and 20 more without repeats", async ({
  browser,
  screen,
  library,
}) => {
  // Settings subscribes to no card lists, so 23 saves don't each re-run
  // the library's queries on the local backend.
  await gotoApp(browser, "/settings");
  const idsByText = new Map<string, string>();
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
  // Let card processing finish first: on a slow local backend, its writes
  // re-run the tag view's query until it times out.
  const stillProcessing = async () => {
    let busy = 0;
    for (const id of idsByText.values()) {
      // react-doctor-disable-next-line react-doctor/async-await-in-loop
      const saved = await library.client.query(api.cards.getCard, { id });
      const stages: ({ status?: string } | undefined)[] = Object.values(
        saved?.processingStatus ?? {}
      );
      if (
        stages.some(
          (stage) =>
            stage?.status === "pending" || stage?.status === "in_progress"
        )
      ) {
        busy += 1;
      }
    }
    return busy;
  };
  await expect.poll(stillProcessing, { timeout: 120_000 }).toBe(0);
  const isArchived = async (text: string) => {
    const id = idsByText.get(text);
    return id
      ? (await library.client.query(api.cards.getCard, { id }))?.isArchived ===
          true
      : undefined;
  };
  const deck = screen.getByRole("dialog", "Revisit");
  const progress = (text: string) => deck.getByText(text, { exact: true });
  // The card on top: its own text, read from the deck.
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

  // A reload deals the same deck from the seed.
  await browser.reload();
  await expect(progress("1 of 20")).toBeVisible({ timeout: 30_000 });
  expect(await current()).toBe(first);

  // ← archives with Undo; Z takes it back and returns to the card.
  await press("ArrowLeft");
  await expect(screen.getByText("Archived 1 card")).toBeVisible();
  await expect(progress("2 of 20")).toBeVisible();
  await expect.poll(() => isArchived(first)).toBe(true);
  await press("z");
  await expect(progress("1 of 20")).toBeVisible();
  expect(await current()).toBe(first);
  await expect.poll(() => isArchived(first)).toBe(false);

  // Archived for good: a reload starts on the old second card.
  await press("ArrowLeft");
  await expect(progress("2 of 20")).toBeVisible();
  const second = await current();
  await expect.poll(() => isArchived(first)).toBe(true);
  await browser.reload();
  await expect(progress("1 of 20")).toBeVisible({ timeout: 30_000 });
  expect(await current()).toBe(second);

  // → keeps every card; 21 remain, so 20, then 1 more, none twice.
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

  // Esc leaves the deck for the library's usual order.
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

  // Space opens the details (their own history entry); Esc closes them.
  await browser.keyboard.press(" ");
  await expect.poll(() => paramOf(browser.url(), "card")).not.toBeNull();
  await browser.keyboard.press("Escape");
  await expect.poll(() => paramOf(browser.url(), "card")).toBeNull();
  await expect(deck.getByText("1 of 1", { exact: true })).toBeVisible();

  await browser.keyboard.press("Escape");
  await expect(deck).toBeHidden();
  await expect.poll(() => paramOf(browser.url(), "sort")).toBe("oldest");
});
