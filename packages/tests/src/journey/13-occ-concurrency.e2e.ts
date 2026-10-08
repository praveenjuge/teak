import { expect, test } from "@playwright/test";
import { apiFetch } from "../helpers/api";
import { createAccount, deleteAccountViaUi } from "../helpers/app";

test.setTimeout(240_000);

test("parallel card operations stay coherent under contention", async ({
  page,
}) => {
  const account = await createAccount(page, "occ-concurrency", {
    remember: false,
  });
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
        // The local stack has no AI provider, so the metadata stage stays
        // pending; renderables is the last stage that runs without it.
        const status = targetCard?.processingStatus?.renderables?.status;
        return status ?? "missing";
      },
      { intervals: [500, 1000, 2000, 3000], timeout: 30_000 }
    )
    .toBe("completed");

  const finalTarget = await apiFetch(`/v1/cards/${target}`, apiKey);
  expect(finalTarget.status).toBe(200);
  await expect(finalTarget.json()).resolves.toMatchObject({
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
      { intervals: [500, 1000, 2000], timeout: 5000 }
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
  const rateCheckConcurrency = 8;
  for (let offset = 0; offset < 40; offset += rateCheckConcurrency) {
    // Keep the harness parallel within the limiter's supported
    // eight-request contention envelope.
    const batch = await Promise.all(
      Array.from({ length: rateCheckConcurrency }, (_, batchIndex) => {
        const index = offset + batchIndex;
        return apiFetch("/v1/cards", apiKey, {
          body: JSON.stringify({ content: `${marker} rate-${index}` }),
          method: "POST",
        });
      })
    );
    rateChecks.push(...batch);
  }
  expect(rateChecks.some((response) => response.status === 429)).toBe(true);
  expect(rateChecks.every((response) => response.status !== 500)).toBe(true);
  await deleteAccountViaUi(page, account);
});
