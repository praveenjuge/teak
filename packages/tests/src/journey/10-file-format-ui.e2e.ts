import { Buffer } from "node:buffer";
import { expect, test } from "@playwright/test";
import { clientFor } from "../helpers/prod";
import { readState } from "../helpers/run-state";

test("web picker and drag-drop upload files with safe opened previews", async ({
  page,
}) => {
  const marker = `web-file-${Date.now()}`;
  const pickedName = `${marker}.mdx`;
  const droppedName = `${marker}-drop.tsx`;
  const markdownName = `${marker}-text.MARKDOWN`;
  const rawMarkdown = `\uFEFF  # ${marker}-text\r\n\r\n- [ ] keep spacing  \n`;
  const state = readState();
  const filesAccount = state.webFiles ?? state.primary;
  if (!filesAccount?.apiKey) {
    throw new Error("Missing web-files API key");
  }
  const api = clientFor(filesAccount.apiKey);

  await page.goto("/");
  await page.getByRole("button", { name: "Upload files" }).click();
  await page
    .locator('input[type="file"]')
    .last()
    .setInputFiles({
      buffer: Buffer.from(`# ${marker}\n\nSafe **preview**`),
      mimeType: "text/mdx",
      name: pickedName,
    });
  const pickedCard = page.getByText(pickedName).first();
  await expect(pickedCard).toBeVisible({
    timeout: 45_000,
  });

  await page.evaluate(
    ({ content, fileName }) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([content], fileName, { type: "text/tsx" }));
      document.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        })
      );
    },
    {
      content: `export const marker = "${marker}";`,
      fileName: droppedName,
    }
  );
  await expect(page.getByText(droppedName).first()).toBeVisible({
    timeout: 45_000,
  });

  const prefetchedFile = page.waitForRequest((request) =>
    decodeURIComponent(request.url()).includes(pickedName)
  );
  await pickedCard.hover();
  await prefetchedFile;
  await pickedCard.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Open file")).toBeVisible();
  await expect(dialog.getByText(marker, { exact: false }).first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(dialog.getByRole("button", { name: /Download/i })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Upload files" }).click();
  await page
    .locator('input[type="file"]')
    .last()
    .setInputFiles({
      buffer: Buffer.from(rawMarkdown),
      mimeType: "text/markdown",
      name: markdownName,
    });
  await expect
    .poll(
      async () =>
        (
          await api.cards.list({
            include: "content,metadata",
            limit: 100,
          })
        ).items.find((card) => card.fileName === markdownName)?.content,
      { timeout: 45_000 }
    )
    .toBe(rawMarkdown);
  await page.getByPlaceholder("Search for anything...").fill(`${marker}-text`);
  await page.keyboard.press("Enter");
  const textCard = page
    .locator("main p")
    .filter({ hasText: `${marker}-text` })
    .first();
  await expect(textCard).toBeVisible();
  await textCard.click();
  const textDialog = page.getByRole("dialog");
  await expect(
    textDialog.getByRole("textbox", { name: "Markdown content" })
  ).toContainText(`${marker}-text`);
  await expect(
    textDialog.getByRole("button", { name: /Download/i })
  ).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Clear All" }).click();
  await page.getByPlaceholder("Search for anything...").fill(marker);
  await page.keyboard.press("Enter");
  await expect(page.getByText(pickedName).first()).toBeVisible({
    timeout: 45_000,
  });
});
