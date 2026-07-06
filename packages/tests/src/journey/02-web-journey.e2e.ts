import { Buffer } from "node:buffer";
import { expect, test } from "@playwright/test";
import { clientFor, generateApiKey, revokeVisibleKey } from "../helpers/prod";
import { readState, updateState } from "../helpers/run-state";

test("web journey covers cards, search, settings, upload, and revoked key", async ({
  page,
}) => {
  const state = readState();
  if (!state.primary?.apiKey) {
    throw new Error("Missing primary API key");
  }
  const marker = `prod-e2e-${Date.now()}`;
  const dialogTrap: string[] = [];
  page.on("dialog", (dialog) => {
    dialogTrap.push(dialog.message());
    return dialog.dismiss();
  });
  await page.goto("/");
  await expect(page.getByText(/Let's add your first card/i)).toBeVisible();
  await page
    .getByPlaceholder(/Write a note/i)
    .fill(`${marker} <script>alert("xss")</script>`);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("main").getByText(marker)).toBeVisible();
  await page.getByPlaceholder("Search for anything...").fill(marker);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main").getByText(marker)).toBeVisible();
  await page.getByRole("button", { name: "Clear All" }).click();

  const api = clientFor(state.primary.apiKey);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64"
  );
  const upload = await api.uploads.create({
    fileName: "pixel.png",
    fileSize: png.byteLength,
    mimeType: "image/png",
  });
  await api.uploads.putFile(upload.uploadUrl, png, "image/png");
  const link = await api.cards.create({
    content: "https://example.com",
    tags: ["prod-e2e"],
    source: "prod-e2e",
  });
  const text = await api.cards.create({
    content: marker,
    tags: ["prod-e2e"],
    source: "prod-e2e",
  });
  await api.cards.setFavorite(text.cardId, true);
  updateState((s) => s.createdCardIds.push(link.cardId, text.cardId));

  await page.goto("/settings");
  await expect(page.getByText(state.primary.email)).toBeVisible();
  await expect(page.getByText("Free Plan")).toBeVisible();
  const revokedKey = await generateApiKey(page);
  await revokeVisibleKey(page, revokedKey);
  updateState((s) => {
    s.revokedKey = revokedKey;
  });
  expect(dialogTrap).toEqual([]);
});
