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

const PASSAGE = "kept 31% more moisture in July";

describe("Highlighting a saved article", () => {
  test("selecting a sentence and pressing H highlights it; its note survives a reload", async ({
    browser,
    library,
    screen,
    webAccount,
  }) => {
    await seedScenario(webAccount, "reader-mix");
    let research: SeededCard | undefined;
    await retry(
      async () => {
        const cards = (await library.client.query(api.cards.getCards, {
          limit: 100,
        })) as SeededCard[];
        research = cards.find((item) =>
          item.url?.startsWith("https://example.com/reader/research")
        );
        expect(research?.article?.status).toBe("ready");
      },
      { timeout: 60_000 }
    );

    await gotoApp(browser, `/?card=${research?._id}`);
    await expect(screen.getByRole("radio", "Read")).toHaveAttribute(
      "aria-checked",
      "true",
      { timeout: 15_000 }
    );
    await expect(screen.getByText(PASSAGE, { exact: false })).toBeVisible({
      timeout: 15_000,
    });

    const selected = await browser.evaluate((passage) => {
      const body = document.querySelector("[data-article-body]");
      const walker = document.createTreeWalker(
        body as Node,
        NodeFilter.SHOW_TEXT
      );
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = (node as Text).data.indexOf(passage);
        if (at >= 0) {
          const range = document.createRange();
          range.setStart(node, at);
          range.setEnd(node, at + passage.length);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          return true;
        }
      }
      return false;
    }, PASSAGE);
    expect(selected).toBe(true);
    await expect(screen.getByRole("button", "Highlight")).toBeVisible();

    await browser.keyboard.press("h");
    const panel = screen.getByRole("region", "Highlights · 1");
    await expect(panel).toBeVisible();
    await expect(panel.getByText(PASSAGE)).toBeVisible();

    const point = await browser.evaluate((passage) => {
      const body = document.querySelector("[data-article-body]");
      const walker = document.createTreeWalker(
        body as Node,
        NodeFilter.SHOW_TEXT
      );
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = (node as Text).data.indexOf(passage);
        if (at >= 0) {
          const range = document.createRange();
          range.setStart(node, at + 2);
          range.setEnd(node, at + 3);
          const rect = range.getBoundingClientRect();
          return {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          };
        }
      }
      return null;
    }, PASSAGE);
    expect(point).not.toBeNull();
    await browser.mouse.move(point?.x ?? 0, point?.y ?? 0);
    await browser.mouse.down();
    await browser.mouse.up();
    const note = screen.getByRole("textbox", "Note on this highlight");
    await expect(note).toBeVisible();
    await note.fill("Worth trying in the dry plot");
    await browser.keyboard.press("Tab");
    await browser.keyboard.press("Escape");
    await expect(panel.getByText("Worth trying in the dry plot")).toBeVisible();

    await browser.reload();
    const reloaded = screen.getByRole("region", "Highlights · 1");
    await expect(reloaded).toBeVisible({ timeout: 15_000 });
    await expect(
      reloaded.getByText("Worth trying in the dry plot")
    ).toBeVisible();
  });
});
