import { RATE_LIMIT_CONFIG } from "@teak/convex/shared/rateLimits";
import { apiFetch } from "../helpers/api";
import { createAccount, deleteAccountViaUi } from "../helpers/app";
import { expect, test } from "../helpers/test";

const CARD_CREATION_SUPPORTED_CONCURRENCY = 8;

test("parallel card operations stay coherent under contention", {
  timeout: 240_000,
}, async ({ browser, screen }) => {
  const surface = { browser, screen };
  const account = await createAccount(surface, "occ-concurrency");
  const apiKey = account.apiKey!;
  const marker = `occ-concurrency-${Date.now()}`;
  const creates = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      apiFetch("/v1/cards", apiKey, {
        body: JSON.stringify({
          content: `${marker} create-${index}`,
          tags: ["occ-concurrency"],
        }),
        method: "POST",
      })
    )
  );
  expect(
    await Promise.all(
      creates.map(async (response) => ({
        body: response.ok ? undefined : await response.text(),
        status: response.status,
      }))
    )
  ).toEqual(
    Array.from({ length: creates.length }, () => ({
      body: undefined,
      status: 200,
    }))
  );
  const created = await Promise.all(creates.map((response) => response.json()));
  const cardIds = created.map((payload) => payload.cardId as string);

  const target = cardIds[0];
  const [patched, favorited, bulk] = await Promise.all([
    apiFetch(`/v1/cards/${target}`, apiKey, {
      body: JSON.stringify({ notes: `${marker} user-write` }),
      method: "PATCH",
    }),
    apiFetch(`/v1/cards/${target}/favorite`, apiKey, {
      body: JSON.stringify({ isFavorited: true }),
      method: "PATCH",
    }),
    apiFetch("/v1/cards/bulk", apiKey, {
      body: JSON.stringify({
        items: cardIds.slice(1, 4).map((cardId) => ({
          cardId,
          notes: `${marker} bulk-write`,
        })),
        operation: "update",
      }),
      method: "POST",
    }),
  ]);
  expect([patched.status, favorited.status, bulk.status]).toEqual([
    200, 200, 200,
  ]);

  await expect
    .poll(
      async () => {
        const response = await apiFetch(
          "/v1/cards?include=processing&limit=100",
          apiKey
        );
        if (!response.ok) {
          return "request-failed";
        }
        const payload = await response.json();
        const targetCard = payload.items?.find(
          (card: { id?: string }) => card.id === target
        );
        const status = targetCard?.processingStatus?.renderables?.status;
        return status ?? "missing";
      },
      { interval: 1000, timeout: 30_000 }
    )
    .toBe("completed");

  const finalTarget = await apiFetch(`/v1/cards/${target}`, apiKey);
  expect(finalTarget.status).toBe(200);
  expect(await finalTarget.json()).toMatchObject({
    isFavorited: true,
    notes: `${marker} user-write`,
  });

  await expect
    .poll(
      async () => {
        const response = await apiFetch(
          `/v1/cards?q=${encodeURIComponent(marker)}`,
          apiKey
        );
        if (!response.ok) {
          return 0;
        }
        return ((await response.json()).items ?? []).length;
      },
      { interval: 500, timeout: 5000 }
    )
    .toBeGreaterThanOrEqual(8);

  const deletions = await Promise.all(
    cardIds
      .slice(4)
      .map((cardId) =>
        apiFetch(`/v1/cards/${cardId}`, apiKey, { method: "DELETE" })
      )
  );
  expect(deletions.every((response) => response.status === 204)).toBe(true);

  const rateChecks: Response[] = [];
  const maxRateChecks = 4 * RATE_LIMIT_CONFIG.cardCreation.capacity;
  const refused = () => rateChecks.some((response) => response.status === 429);
  for (
    let offset = 0;
    offset < maxRateChecks && !refused();
    offset += CARD_CREATION_SUPPORTED_CONCURRENCY
  ) {
    const batch = await Promise.all(
      Array.from(
        { length: CARD_CREATION_SUPPORTED_CONCURRENCY },
        (_, batchIndex) => {
          const index = offset + batchIndex;
          return apiFetch("/v1/cards", apiKey, {
            body: JSON.stringify({ content: `${marker} rate-${index}` }),
            method: "POST",
          });
        }
      )
    );
    rateChecks.push(...batch);
  }
  expect(refused()).toBe(true);
  expect(rateChecks.every((response) => response.status !== 500)).toBe(true);
  await deleteAccountViaUi(surface, account);
});
