import {
  clickVisibleControl,
  clientFor,
  createAccount,
  gotoApp,
} from "../helpers/app";
import { describe, expect, type Screen, test } from "../helpers/test";

// One fresh account for the file, created by the first test and kept for the
// rest of the group.
let apiKey = "";

const filtersContext = () => {
  expect(apiKey, "web-filters API key").toMatch(/^teakapi_/);
  return { api: clientFor(apiKey), apiKey };
};

const markerFor = (label: string) => `e2e-${label}-${Date.now().toString(36)}`;

const cardText = (screen: Screen, text: string | RegExp) =>
  screen.getByRole("main").getByText(text, { exact: false }).first();

const focusSearch = async (screen: Screen) => {
  const search = screen.getByRole("combobox");
  await search.click();
  return search;
};

const clearFilters = async (screen: Screen) => {
  const clear = screen.getByRole("button", /Clear (All|filters)/i, {
    visible: true,
  });
  await clickVisibleControl(clear);
};

describe("quote, favorites, and type filters", { serial: true }, () => {
  test("quote cards open in the modal and stay searchable", {
    timeout: 180_000,
  }, async ({ browser, screen }) => {
    apiKey =
      (await createAccount({ browser, screen }, "web-filters")).apiKey ?? "";
    const { api } = filtersContext();
    const marker = markerFor("quote");
    const quoteBody = `${marker} be curious always`;
    const created = await api.cards.create({
      content: `"${quoteBody}"`,
      tags: ["e2e", "quote"],
      source: "e2e",
    });

    await expect
      .poll(
        async () => {
          const card = await api.cards.get(created.cardId);
          return card?.type;
        },
        { timeout: 45_000, interval: 1000 }
      )
      .toBe("quote");

    await gotoApp(browser, "/");
    await expect(cardText(screen, quoteBody)).toBeVisible({
      timeout: 30_000,
    });
    await cardText(screen, quoteBody).click();
    const dialog = screen.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/Quote/i).first()).toBeVisible();
    await expect(browser.locator('[role="dialog"] textarea')).toHaveValue(
      quoteBody
    );
    await browser.keyboard.press("Escape");

    const search = await focusSearch(screen);
    await search.fill(marker);
    await expect(cardText(screen, quoteBody)).toBeVisible();
    // Typed text alone shows no chips (so no Clear all); empty the box.
    await search.fill("");
  });

  test("favorites filter and unfavorite stay coherent", async ({
    browser,
    screen,
  }) => {
    const { api } = filtersContext();
    const marker = markerFor("fav");
    const favorited = await api.cards.create({
      content: `${marker} keep-me`,
      tags: ["e2e"],
      source: "e2e",
    });
    await api.cards.create({
      content: `${marker} hide-me`,
      tags: ["e2e"],
      source: "e2e",
    });
    await api.cards.setFavorite(favorited.cardId, true);

    await gotoApp(browser, "/");
    await expect(cardText(screen, `${marker} keep-me`)).toBeVisible({
      timeout: 30_000,
    });
    // Favorites is its own page in the sidebar.
    await clickVisibleControl(screen.getByRole("link", "Favorites"));
    await expect(screen.getByPlaceholder("Search favorites...")).toBeVisible();
    await expect(cardText(screen, `${marker} keep-me`)).toBeVisible();
    await expect(cardText(screen, `${marker} hide-me`)).not.toBeVisible();

    await cardText(screen, `${marker} keep-me`).click();
    await clickVisibleControl(
      screen
        .getByRole("dialog")
        .getByRole("button", "Unfavorite", { exact: false })
    );
    await browser.keyboard.press("Escape");
    await expect(cardText(screen, `${marker} keep-me`)).not.toBeVisible({
      timeout: 15_000,
    });
    await clickVisibleControl(screen.getByRole("link", "Everything"));
    await expect(cardText(screen, `${marker} keep-me`)).toBeVisible();
  });

  test("type filters for quote and palette isolate matching cards", async ({
    browser,
    screen,
  }) => {
    const { api } = filtersContext();
    const marker = markerFor("type");
    const quote = await api.cards.create({
      content: `"${marker} quoted line"`,
      tags: ["e2e"],
      source: "e2e",
    });
    const palette = await api.cards.create({
      content: `#AABBCC ${marker}`,
      tags: ["e2e"],
      source: "e2e",
    });
    await api.cards.create({
      content: `${marker} plain note`,
      tags: ["e2e"],
      source: "e2e",
    });

    await expect
      .poll(
        async () => {
          const [quoteCard, paletteCard] = await Promise.all([
            api.cards.get(quote.cardId),
            api.cards.get(palette.cardId),
          ]);
          return `${quoteCard?.type}:${paletteCard?.type}`;
        },
        { timeout: 45_000, interval: 1000 }
      )
      .toBe("quote:palette");

    await gotoApp(browser, "/");
    await expect(cardText(screen, `${marker} plain note`)).toBeVisible({
      timeout: 30_000,
    });

    // Card types are sidebar buttons; a picked one also shows as a chip.
    await clickVisibleControl(screen.getByRole("button", "Quote").first());
    await expect(cardText(screen, `${marker} quoted line`)).toBeVisible();
    await expect(cardText(screen, `${marker} plain note`)).not.toBeVisible();
    await clearFilters(screen);

    await clickVisibleControl(screen.getByRole("button", "Palette").first());
    await expect(cardText(screen, `${marker} plain note`)).not.toBeVisible();
    await expect(screen.getByRole("main")).not.toContainText(
      `${marker} quoted line`
    );
    // Palette cards may render swatches instead of raw content; assert via
    // filter.
    await expect(screen.getByRole("button", "Palette").first()).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await clearFilters(screen);
  });
});
