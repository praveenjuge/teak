import { Buffer } from "node:buffer";
import { expect, test } from "@playwright/test";

test("web picker and drag-drop upload files with safe opened previews", async ({
  page,
}) => {
  const marker = `web-file-${Date.now()}`;
  const pickedName = `${marker}.mdx`;
  const droppedName = `${marker}-drop.tsx`;
  const markdownName = `${marker}-text.MARKDOWN`;
  const rawMarkdown = `\uFEFF  # ${marker}-text\r\n\r\n- [ ] keep spacing  \n`;

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
  await expect(page.getByText(`${pickedName} uploaded`)).toBeVisible({
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
  await expect(page.getByText(`${droppedName} uploaded`)).toBeVisible({
    timeout: 45_000,
  });

  const markdownCard = page.getByText(pickedName).first();
  await expect(markdownCard).toBeVisible();
  const prefetchedFile = page.waitForRequest((request) =>
    decodeURIComponent(request.url()).includes(pickedName)
  );
  await markdownCard.hover();
  await prefetchedFile;
  await markdownCard.click();
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
  await expect(page.getByText(`${markdownName} uploaded`)).toBeVisible({
    timeout: 45_000,
  });
  await page.getByPlaceholder("Search for anything...").fill(`${marker}-text`);
  await page.keyboard.press("Enter");
  const textCard = page
    .getByRole("main")
    .getByText(`${marker}-text`, { exact: false })
    .first();
  await expect(textCard).toBeVisible();
  await textCard.click();
  const textDialog = page.getByRole("dialog");
  await expect(textDialog.getByPlaceholder("Enter your text...")).toHaveValue(
    rawMarkdown
  );
  await expect(
    textDialog.getByRole("button", { name: /Download/i })
  ).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByPlaceholder("Search for anything...").fill(marker);
  await page.keyboard.press("Enter");
  await expect(page.getByText(pickedName).first()).toBeVisible();
});
