import { Buffer } from "node:buffer";
import { expect, test } from "@playwright/test";
import { env } from "../helpers/env";
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
  await expect(page.getByPlaceholder(/Write a note/i)).toBeVisible();
  await expect(
    page.getByText(/Welcome to Teak|Let's add your first card/i)
  ).toBeVisible();
  await page
    .getByPlaceholder(/Write a note/i)
    .fill(`${marker} <script>alert("xss")</script>`);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const savedCard = page.locator("main p").filter({ hasText: marker }).first();
  await expect(savedCard).toBeVisible();
  await page.getByPlaceholder("Search for anything...").fill(marker);
  await page.keyboard.press("Enter");
  await expect(savedCard).toBeVisible();
  await page.getByRole("button", { name: "Clear All" }).click();

  await page.context().grantPermissions(["microphone"], { origin: env.appUrl });
  await page.getByRole("button", { name: "Record audio" }).click();
  await expect(
    page.getByRole("dialog", { name: "Recording audio" })
  ).toBeVisible();
  await expect(page.getByText(/Speak naturally/i)).toBeVisible();
  await expect(page.getByText("0:01")).toBeVisible({ timeout: 5000 });
  await page.getByRole("button", { name: "Stop and Save" }).click();
  await expect(page.getByText("Audio recording saved")).toBeVisible({
    timeout: 45_000,
  });

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

test("saving a color in the composer creates a palette card", async ({
  page,
}) => {
  // Regression: the web note composer forced type "text", which disabled
  // server-side classification, so colors stopped becoming palette cards.
  const state = readState();
  if (!state.primary?.apiKey) {
    throw new Error("Missing primary API key");
  }
  const hex = "#2050D0";

  await page.goto("/");
  await page.getByPlaceholder(/Write a note/i).fill(hex);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  // The optimistic card appears immediately; classification runs server-side.
  await expect(
    page.locator("main").getByText(hex, { exact: true }).first()
  ).toBeVisible();

  // Poll the API until the composer-created card is classified as a palette.
  const api = clientFor(state.primary.apiKey);
  await expect
    .poll(
      async () => {
        const result = await api.cards.search({ type: "palette" });
        return result.items.some((card) => card.content === hex);
      },
      { timeout: 30_000, intervals: [1000, 2000, 3000, 5000] }
    )
    .toBe(true);
});
