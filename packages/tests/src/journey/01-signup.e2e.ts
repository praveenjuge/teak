import { apiFetch } from "../helpers/api";
import { apiStatus, clientFor, createAccount } from "../helpers/app";
import { findEmulatorUser, waitForEmailedEvent } from "../helpers/emulator";
import { expect, test } from "../helpers/test";

test("new WorkOS users get isolated Teak vaults and API keys", {
  timeout: 240_000,
}, async ({ app, browser, screen }) => {
  const surface = { browser, screen };
  // The first account signs up unverified, so its first sign-in goes through
  // the emailed verification code before the vault opens, and its API key
  // comes from Settings.
  const first = await createAccount(surface, "primary", {
    emailVerified: false,
  });
  await waitForEmailedEvent("email_verification.created", first.email);
  expect(await findEmulatorUser(first.email)).toMatchObject({
    email_verified: true,
  });
  const firstKey = first.apiKey ?? "";
  expect(await apiStatus(firstKey)).toBe(200);

  // A second sign-up in a fresh browser gets a vault of its own.
  await app.clearState();
  const second = await createAccount(surface, "isolated");
  const secondKey = second.apiKey ?? "";
  expect(await apiStatus(secondKey)).toBe(200);

  const marker = `signup-isolation-${Date.now()}`;
  const { cardId } = await clientFor(firstKey).cards.create({
    content: marker,
    source: "e2e",
  });
  // The owner finds the card, so the second account's empty search below is
  // isolation, not an index that hasn't caught up.
  await expect
    .poll(
      async () =>
        (await clientFor(firstKey).cards.search({ query: marker })).items.some(
          (card) => card.id === cardId
        ),
      { timeout: 30_000, interval: 1000 }
    )
    .toBe(true);
  expect((await apiFetch(`/v1/cards/${cardId}`, secondKey)).status).toBe(404);
  expect(
    (await clientFor(secondKey).cards.search({ query: marker })).items
  ).toEqual([]);
});
