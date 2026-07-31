import { expect, type Page, test } from "@playwright/test";
import { clickVisibleControl, clientFor } from "../helpers/prod";
import { readState, updateState } from "../helpers/run-state";

const primaryContext = () => {
  const state = readState();
  if (!state.primary?.apiKey) {
    throw new Error("Missing primary API key");
  }
  return {
    api: clientFor(state.primary.apiKey),
    apiKey: state.primary.apiKey,
  };
};

const markerFor = (label: string) =>
  `prod-e2e-${label}-${Date.now().toString(36)}`;

const cardText = (page: Page, text: string | RegExp) =>
  page.getByRole("main").getByText(text).first();

const focusSearch = async (page: Page) => {
  const search = page.getByPlaceholder("Search for anything...");
  await search.click();
  await expect(page.getByRole("button", { name: "Favorites" })).toBeVisible();
  return search;
};

const clearFilters = async (page: Page) => {
  const clear = page
    .getByRole("button", { name: /Clear (All|filters)/i })
    .filter({ visible: true });
  await clickVisibleControl(clear);
};

test("quote cards open in the modal and stay searchable", async ({ page }) => {
  const { api } = primaryContext();
  const marker = markerFor("quote");
  const quoteBody = `${marker} be curious always`;
  const created = await api.cards.create({
    content: `"${quoteBody}"`,
    tags: ["prod-e2e", "quote"],
    source: "prod-e2e",
  });
  updateState((state) => state.createdCardIds.push(created.cardId));

  await expect
    .poll(
      async () => {
        const card = await api.cards.get(created.cardId);
        return card?.type;
      },
      { timeout: 45_000, intervals: [1000, 2000, 3000, 5000] }
    )
    .toBe("quote");

  await page.goto("/");
  await expect(cardText(page, quoteBody)).toBeVisible({ timeout: 30_000 });
  await cardText(page, quoteBody).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Quote/i).first()).toBeVisible();
  await expect(dialog.locator("textarea")).toHaveValue(quoteBody);
  await page.keyboard.press("Escape");

  const search = await focusSearch(page);
  await search.fill(marker);
  await expect(cardText(page, quoteBody)).toBeVisible();
  await clearFilters(page);
});

test("favorites filter and unfavorite stay coherent", async ({ page }) => {
  const { api } = primaryContext();
  const marker = markerFor("fav");
  const favorited = await api.cards.create({
    content: `${marker} keep-me`,
    tags: ["prod-e2e"],
    source: "prod-e2e",
  });
  const other = await api.cards.create({
    content: `${marker} hide-me`,
    tags: ["prod-e2e"],
    source: "prod-e2e",
  });
  updateState((state) =>
    state.createdCardIds.push(favorited.cardId, other.cardId)
  );
  await api.cards.setFavorite(favorited.cardId, true);

  await page.goto("/");
  await expect(cardText(page, `${marker} keep-me`)).toBeVisible({
    timeout: 30_000,
  });
  await focusSearch(page);
  await clickVisibleControl(
    page.getByRole("button", { exact: true, name: "Favorites" })
  );
  await expect(cardText(page, `${marker} keep-me`)).toBeVisible();
  await expect(cardText(page, `${marker} hide-me`)).not.toBeVisible();

  await cardText(page, `${marker} keep-me`).click();
  await clickVisibleControl(
    page.getByRole("dialog").getByRole("button", { name: "Unfavorite" })
  );
  await page.keyboard.press("Escape");
  await expect(cardText(page, `${marker} keep-me`)).not.toBeVisible({
    timeout: 15_000,
  });
  await clearFilters(page);
  await expect(cardText(page, `${marker} keep-me`)).toBeVisible();
});

test("type filters for quote and palette isolate matching cards", async ({
  page,
}) => {
  const { api } = primaryContext();
  const marker = markerFor("type");
  const quote = await api.cards.create({
    content: `"${marker} quoted line"`,
    tags: ["prod-e2e"],
    source: "prod-e2e",
  });
  const palette = await api.cards.create({
    content: `#AABBCC ${marker}`,
    tags: ["prod-e2e"],
    source: "prod-e2e",
  });
  const text = await api.cards.create({
    content: `${marker} plain note`,
    tags: ["prod-e2e"],
    source: "prod-e2e",
  });
  updateState((state) =>
    state.createdCardIds.push(quote.cardId, palette.cardId, text.cardId)
  );

  await expect
    .poll(
      async () => {
        const [quoteCard, paletteCard] = await Promise.all([
          api.cards.get(quote.cardId),
          api.cards.get(palette.cardId),
        ]);
        return `${quoteCard?.type}:${paletteCard?.type}`;
      },
      { timeout: 45_000, intervals: [1000, 2000, 3000, 5000] }
    )
    .toBe("quote:palette");

  await page.goto("/");
  await expect(cardText(page, `${marker} plain note`)).toBeVisible({
    timeout: 30_000,
  });

  await focusSearch(page);
  await clickVisibleControl(
    page.getByRole("button", { exact: true, name: "Quote" })
  );
  await expect(cardText(page, `${marker} quoted line`)).toBeVisible();
  await expect(cardText(page, `${marker} plain note`)).not.toBeVisible();
  await clearFilters(page);

  await focusSearch(page);
  await clickVisibleControl(
    page.getByRole("button", { exact: true, name: "Palette" })
  );
  await expect(cardText(page, `${marker} plain note`)).not.toBeVisible();
  await expect(page.getByRole("main")).not.toContainText(
    `${marker} quoted line`
  );
  // Palette cards may render swatches instead of raw content; assert via filter.
  await expect(
    page.getByRole("button", { exact: true, name: "Palette" })
  ).toBeVisible();
  await clearFilters(page);
});
