import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import { describe } from "../helpers/test";
import { COMPOSER_EDITOR, pasteMarkdown } from "./editor-library";
import { expect, test } from "./fixtures";

interface SavedCard {
  _id: Id<"cards">;
  type?: string;
  url?: string;
}

describe("Pasting a list of links", () => {
  test("saves 12 pasted links as 12 link cards", async ({
    browser,
    screen,
    library,
  }) => {
    const run = `run=${Date.now()}`;
    const urls = Array.from(
      { length: 12 },
      (_, index) => `https://example.com/paste/${index + 1}?${run}`
    );
    const pastedCards = async () =>
      (
        (await library.client.query(api.cards.getCards, {
          limit: 100,
        })) as SavedCard[]
      ).filter((card) => card.url?.includes(run));

    await pasteMarkdown(
      browser,
      COMPOSER_EDITOR,
      urls.map((url) => `- ${url}`).join("\n")
    );
    const save = screen.getByRole("button", "Save 12 links", { exact: false });
    await expect(save).toBeEnabled();
    await save.click();

    await expect(screen.getByText("Saved 12 links")).toBeVisible({
      timeout: 60_000,
    });
    await expect
      .poll(async () => (await pastedCards()).length, { timeout: 60_000 })
      .toBe(12);
    const cards = await pastedCards();
    library.ids.push(...cards.map((card) => card._id));
    expect(cards.map((card) => card.url).sort()).toEqual([...urls].sort());
    expect(cards.every((card) => card.type === "link")).toBe(true);
    await expect(
      browser.locator(`main [data-card-id][aria-label*="${run}"]`)
    ).toHaveCount(12, { timeout: 60_000 });
  });

  test("moves a pasted link already in Teak to the top instead of saving it twice", async ({
    browser,
    screen,
    library,
  }) => {
    const run = `run=${Date.now()}`;
    const known = `https://example.com/known?${run}`;
    const existing = await library.client.mutation(api.cards.createCard, {
      content: known,
    });
    library.ids.push(existing);
    const pastedCards = async () =>
      (
        (await library.client.query(api.cards.getCards, {
          limit: 100,
        })) as SavedCard[]
      ).filter((card) => card.url?.includes(run));

    await pasteMarkdown(
      browser,
      COMPOSER_EDITOR,
      [
        `https://example.com/new/1?${run}`,
        `https://www.example.com/known?${run}&utm_source=newsletter`,
        `https://example.com/new/2?${run}`,
      ].join("\n")
    );
    await screen.getByRole("button", "Save 3 links", { exact: false }).click();

    await expect(
      screen.getByText("Saved 2 links · 1 already in Teak, moved to the top")
    ).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(async () => (await pastedCards()).length, { timeout: 60_000 })
      .toBe(3);
    const cards = await pastedCards();
    library.ids.push(
      ...cards.map((card) => card._id).filter((id) => id !== existing)
    );
    expect(cards.filter((card) => card.url?.includes("/known"))).toEqual([
      expect.objectContaining({ _id: existing, url: known }),
    ]);
  });
});
