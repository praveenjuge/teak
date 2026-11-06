import { readFileSync } from "node:fs";
import { api } from "@teak/convex";
import type { Doc } from "@teak/convex/_generated/dataModel";
import { gotoApp } from "../helpers/app";
import { type Browser, describe } from "../helpers/test";
import { expect, test } from "./fixtures";

const SOURCE = readFileSync(
  new URL("./preview-fixtures/code-preview.ts", import.meta.url),
  "utf8"
);
const PREVIEW = '[role="dialog"] pre[data-not-typeset]';

const expectSourcePreview = async (browser: Browser) => {
  await expect(browser.locator(PREVIEW)).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() =>
      browser.evaluate(
        (selector: string) =>
          document.querySelector(`${selector} code`)?.textContent ?? null,
        PREVIEW
      )
    )
    .toBe(SOURCE);
  const appearance = await browser.evaluate((selector: string) => {
    const pre = document.querySelector(selector);
    if (!pre) {
      throw new Error("Source preview is missing");
    }
    const style = getComputedStyle(pre);
    const coloredTokens = [...pre.querySelectorAll("code span")].filter(
      (token) =>
        Boolean(token.textContent?.trim()) &&
        getComputedStyle(token).color !== style.color
    ).length;
    return {
      background: style.backgroundColor,
      coloredTokens,
      scriptElements: pre.querySelectorAll("script").length,
      scriptRan: "__teakCodePreviewExecuted" in window,
    };
  }, PREVIEW);
  expect(appearance.background).toBe("rgb(30, 30, 30)");
  expect(appearance.coloredTokens).toBeGreaterThan(0);
  expect(appearance.scriptElements).toBe(0);
  expect(appearance.scriptRan).toBe(false);
};

describe("File code previews and native labels", () => {
  test("an uploaded source file keeps highlighted, inert code after reload", {
    timeout: 180_000,
  }, async ({ browser, library }) => {
    // e2e has no file-chooser fixture; send the same DataTransfer as a drop.
    await browser.evaluate((source: string) => {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(
        new File([source], "code-preview.ts", { type: "text/typescript" })
      );
      for (const type of ["dragenter", "dragover", "drop"]) {
        document.body.dispatchEvent(
          new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer })
        );
      }
      return null;
    }, SOURCE);

    await expect
      .poll(
        async () => {
          const cards: Doc<"cards">[] = await library.client.query(
            api.cards.getCards,
            {}
          );
          const uploaded = cards.find(
            (card) => card.fileMetadata?.fileName === "code-preview.ts"
          );
          if (uploaded && !library.ids.includes(uploaded._id)) {
            library.ids.push(uploaded._id);
          }
          return Boolean(uploaded);
        },
        { timeout: 60_000 }
      )
      .toBe(true);
    const id = library.ids[0];
    if (!id) {
      throw new Error("Uploaded source file was not stored");
    }
    await browser.locator(`[data-card-id="${id}"]`).click();
    await expectSourcePreview(browser);
    await expect
      .poll(async () => new URL(await browser.url()).searchParams.get("card"))
      .toBe(id);
    await browser.reload();
    await expectSourcePreview(browser);
  });

  test("clicking the API-key name label focuses its input", async ({
    browser,
    screen,
    webAccount: _signedIn,
  }) => {
    await gotoApp(browser, "/settings/integrations");
    const panel = screen.getByRole("region", "API keys");
    const create = panel.getByRole("button", "Create key");
    const label = panel.getByText("Name for a new key (optional)");
    const name = panel.getByRole("textbox", "Name for a new key (optional)");
    await expect(create).toBeEnabled();
    await create.focus();
    await label.click();
    await expect(name).toBeFocused();
    await expect(name).toHaveValue("");
    await expect(panel.getByRole("textbox", "New API key")).toHaveCount(0);
  });
});
