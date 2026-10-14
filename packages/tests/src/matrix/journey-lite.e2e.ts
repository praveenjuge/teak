import {
  clientFor,
  createAccount,
  fillAndSubmitTextCard,
  gotoApp,
} from "../helpers/app";
import { expect, test } from "../helpers/test";

test("signup, create, and search", { timeout: 180_000 }, async ({
  browser,
  screen,
}) => {
  const surface = { browser, screen };
  const account = await createAccount(surface, "matrix");
  const marker = `matrix-${Date.now()}`;
  await gotoApp(browser, "/");
  await expect(
    screen.getByText(
      "Welcome to Teak! Start capturing your thoughts, links, and inspiration."
    )
  ).toBeVisible();
  await fillAndSubmitTextCard(surface, marker);
  const api = clientFor(account.apiKey ?? "");
  await expect
    .poll(
      async () =>
        (await api.cards.search({ query: marker })).items.some(
          (card) => card.content === marker
        ),
      { timeout: 30_000, interval: 1000 }
    )
    .toBe(true);
  const savedCard = screen.getByRole("main").getByText(marker).first();
  await expect(savedCard).toBeVisible();
  const search = screen.getByPlaceholder("Search everything");
  await search.fill(`${marker}-missing`);
  await expect(savedCard).toBeHidden();
  await expect(screen.getByText(/nothing found/i)).toBeVisible();
  await search.fill(marker);
  await expect(savedCard).toBeVisible();
});
