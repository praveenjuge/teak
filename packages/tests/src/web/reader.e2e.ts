import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import { gotoApp } from "../helpers/app";
import { seedScenario } from "../helpers/seed";
import { describe, retry } from "../helpers/test";
import { expect, test } from "./fixtures";

interface SeededCard {
  _id: Id<"cards">;
  article?: { status: string };
  url?: string;
}

const LONG_READ = "The patient garden: a long read";

describe("Reading a saved article", () => {
  test("opens on Read, R switches to Preview and back, and the reader shows the article", async ({
    browser,
    library,
    screen,
    webAccount,
  }) => {
    await seedScenario(webAccount, "reader-mix");
    // The Markdown is written right after the cards; wait for the article.
    let longRead: SeededCard | undefined;
    await retry(
      async () => {
        const cards = (await library.client.query(api.cards.getCards, {
          limit: 100,
        })) as SeededCard[];
        longRead = cards.find((item) =>
          item.url?.startsWith("https://example.com/reader/long-form")
        );
        expect(longRead?.article?.status).toBe("ready");
      },
      { timeout: 60_000 }
    );

    await gotoApp(browser, `/?card=${longRead?._id}`);
    const read = screen.getByRole("radio", "Read");
    const preview = screen.getByRole("radio", "Preview");
    await expect(read).toHaveAttribute("aria-checked", "true", {
      timeout: 15_000,
    });
    // The dialog's own title is a hidden heading with the same name, so the
    // reader's heading is looked for inside the article.
    const reader = screen.getByRole("article");
    await expect(reader.getByRole("heading", LONG_READ)).toBeVisible({
      timeout: 15_000,
    });
    await expect(reader.getByText("Planting calendar")).toBeVisible();
    // A table, not rows of pipe text.
    await expect(reader.getByRole("cell", "Tomato")).toBeVisible();
    await expect(
      screen.getByRole("link", "Open original ↗", { exact: false })
    ).toBeVisible();

    await browser.keyboard.press("r");
    await expect(preview).toHaveAttribute("aria-checked", "true");
    await expect(screen.getByText("Planting calendar")).toBeHidden();

    await browser.keyboard.press("r");
    await expect(read).toHaveAttribute("aria-checked", "true");
    await expect(reader.getByRole("heading", LONG_READ)).toBeVisible();
  });
});
