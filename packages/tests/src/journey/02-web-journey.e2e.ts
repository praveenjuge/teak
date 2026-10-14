import {
  clientFor,
  composerOf,
  createAccount,
  generateApiKey,
  gotoApp,
  openSecurityDialog,
  revokeVisibleKey,
} from "../helpers/app";
import { describe, expect, test } from "../helpers/test";

// One fresh account for the file: the journey expects an empty vault, and
// the palette check reuses its session and API key.
let email = "";
let apiKey = "";

describe("web core journey", { serial: true }, () => {
  test("web journey covers cards, search, settings, and a revoked key", {
    timeout: 180_000,
  }, async ({ browser, screen }) => {
    const surface = { browser, screen };
    const account = await createAccount(surface, "web-core");
    email = account.email;
    apiKey = account.apiKey ?? "";
    expect(apiKey, "web-core API key").toMatch(/^teakapi_/);
    const api = clientFor(apiKey);
    const marker = `e2e-${Date.now()}`;
    const rawMarkdown = `${marker} <script>alert("xss")</script>`;
    const expectedMarkdown = `${marker} &lt;script&gt;alert("xss")&lt;/script&gt;`;
    const dialogTrap: string[] = [];
    await browser.onDialog(async (dialog) => {
      dialogTrap.push(dialog.message);
      await dialog.dismiss();
    });
    await gotoApp(browser, "/");
    const composer = composerOf(screen);
    await expect(composer).toBeVisible();
    await expect(
      screen.getByText(/Welcome to Teak|Let's add your first card/i)
    ).toBeVisible();
    await composer.fill(rawMarkdown);
    await screen.getByRole("button", "Save").click();
    const savedCard = browser
      .locator("main p")
      .filter({ hasText: marker })
      .first();
    await expect(savedCard).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(
        async () =>
          (await api.cards.search({ query: marker })).items.find((card) =>
            card.content?.includes(marker)
          )?.content,
        { timeout: 30_000, interval: 1000 }
      )
      .toBe(expectedMarkdown);
    await screen.getByPlaceholder("Search everything").fill(marker);
    await browser.keyboard.press("Enter");
    await expect(savedCard).toBeVisible();
    await screen.getByRole("button", "Clear All", { exact: false }).click();

    await api.cards.create({
      content: "https://example.com",
      tags: ["e2e"],
      source: "e2e",
    });
    const text = await api.cards.create({
      content: marker,
      tags: ["e2e"],
      source: "e2e",
    });
    await api.cards.setFavorite(text.cardId, true);

    await gotoApp(browser, "/settings");
    await expect(screen.getByText(email, { exact: false })).toBeVisible();
    await expect(screen.getByText("Free Plan", { exact: false })).toBeVisible();
    // Settings loads the device list on every visit, and the page must not
    // be left while that read is in flight. Seeing this device in Security
    // shows it finished before generateApiKey reloads Settings.
    const security = await openSecurityDialog(surface);
    await expect(
      security.getByText("This device", { exact: false })
    ).toBeVisible();
    const revokedKey = await generateApiKey(surface);
    await revokeVisibleKey(surface, revokedKey);
    expect(dialogTrap).toEqual([]);
  });

  test("saving a color in the composer creates a palette card", async ({
    browser,
    screen,
  }) => {
    // Regression: the web note composer forced type "text", which disabled
    // server-side classification, so colors stopped becoming palette cards.
    expect(apiKey, "web-core API key from the journey").toMatch(/^teakapi_/);
    const hex = "#2050D0";

    await gotoApp(browser, "/");
    const composer = composerOf(screen);
    await composer.fill(hex);
    await screen.getByRole("button", "Save").click();
    // The optimistic card appears immediately; classification runs
    // server-side.
    await expect(screen.getByRole("main").getByText(hex).first()).toBeVisible();

    // Poll the API until the composer-created card is classified as a
    // palette.
    const api = clientFor(apiKey);
    await expect
      .poll(
        async () => {
          const result = await api.cards.search({ type: "palette" });
          return result.items.some((card) => card.content === hex);
        },
        { timeout: 30_000, interval: 1000 }
      )
      .toBe(true);
  });
});
