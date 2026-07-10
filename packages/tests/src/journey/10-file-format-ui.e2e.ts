import { Buffer } from "node:buffer";
import { expect, test } from "@playwright/test";

test("web picker and drag-drop upload files with safe opened previews", async ({
  page,
}) => {
  const marker = `web-file-${Date.now()}`;
  const pickedName = `${marker}.mdx`;
  const droppedName = `${marker}-drop.tsx`;

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

  await expect(page.getByText(pickedName).first()).toBeVisible();
  await page.getByText(pickedName).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Open file")).toBeVisible();
  await expect(dialog.getByText(marker, { exact: false }).first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(dialog.getByRole("button", { name: /Download/i })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByPlaceholder("Search for anything...").fill(marker);
  await page.keyboard.press("Enter");
  await expect(page.getByText(pickedName).first()).toBeVisible();
});
