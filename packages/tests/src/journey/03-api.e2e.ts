import { expect, test } from "@playwright/test";
import { apiFetch, loadOpenApi } from "../helpers/api";
import { readState, updateState } from "../helpers/run-state";

test("REST API happy paths and OpenAPI contracts", async () => {
  const { primary } = readState();
  if (!primary?.apiKey) {
    throw new Error("Missing primary API key");
  }
  const openapi = await loadOpenApi();
  for (const path of [
    "/v1/cards",
    "/v1/cards/search",
    "/v1/cards/favorites",
    "/v1/tags",
  ]) {
    const response = await apiFetch(path, primary.apiKey);
    expect(response.ok).toBe(true);
    openapi.validate(
      path,
      "GET",
      response.status,
      await response.clone().json()
    );
  }
  const created = await apiFetch("/v1/cards", primary.apiKey, {
    method: "POST",
    body: JSON.stringify({
      content: `api-prod-e2e-${Date.now()}`,
      tags: ["prod-e2e"],
      source: "prod-e2e",
    }),
  });
  const payload = await created.json();
  openapi.validate("/v1/cards", "POST", created.status, payload);
  updateState((s) => s.createdCardIds.push(payload.cardId));
  const cardPath = `/v1/cards/${payload.cardId}`;
  expect((await apiFetch(cardPath, primary.apiKey)).status).toBe(200);
  expect(
    (
      await apiFetch(`${cardPath}/favorite`, primary.apiKey, {
        method: "PATCH",
        body: JSON.stringify({ isFavorited: true }),
      })
    ).status
  ).toBe(200);
  expect(
    (
      await apiFetch(cardPath, primary.apiKey, {
        method: "PATCH",
        body: JSON.stringify({ notes: "updated by prod e2e" }),
      })
    ).status
  ).toBe(200);
  expect(
    (
      await apiFetch("/v1/cards/bulk", primary.apiKey, {
        method: "POST",
        body: JSON.stringify({
          operation: "create",
          items: [{ content: "bulk prod e2e" }],
        }),
      })
    ).status
  ).toBe(200);
  expect((await apiFetch("/v1/cards/not-a-card", primary.apiKey)).status).toBe(
    404
  );
});

test("saving a URL as content creates a link card, not a text card", async () => {
  // Regression: a bare URL (e.g. a Goodreads book link) submitted as card
  // content was stored as a "text" card instead of being recognized as a link.
  const { primary } = readState();
  if (!primary?.apiKey) {
    throw new Error("Missing primary API key");
  }
  const bookUrl =
    "https://www.goodreads.com/book/show/2767052-the-hunger-games";
  const created = await apiFetch("/v1/cards", primary.apiKey, {
    method: "POST",
    body: JSON.stringify({
      content: bookUrl,
      tags: ["prod-e2e"],
      source: "prod-e2e",
    }),
  });
  expect(created.status).toBe(200);
  const payload = await created.json();
  updateState((s) => s.createdCardIds.push(payload.cardId));

  // The create response should already reflect the link classification.
  expect(payload.card?.type).toBe("link");
  expect(payload.card?.url).toBe(bookUrl);

  // And it should persist as a link when fetched back.
  const fetched = await apiFetch(`/v1/cards/${payload.cardId}`, primary.apiKey);
  expect(fetched.status).toBe(200);
  const fetchedPayload = await fetched.json();
  expect(fetchedPayload.type).toBe("link");
  expect(fetchedPayload.url).toBe(bookUrl);
});

test("saving a color as content creates a palette card, not a text card", async () => {
  // Regression: saving a color (single hex, or a list of colors/names) as card
  // content stopped becoming a "palette" card and stuck as "text". Palette
  // classification runs asynchronously after creation, so poll until it lands.
  const { primary } = readState();
  if (!primary?.apiKey) {
    throw new Error("Missing primary API key");
  }
  const apiKey = primary.apiKey;
  const created = await apiFetch("/v1/cards", apiKey, {
    method: "POST",
    body: JSON.stringify({
      content: "#2050D0",
      tags: ["prod-e2e"],
      source: "prod-e2e",
    }),
  });
  expect(created.status).toBe(200);
  const payload = await created.json();
  updateState((s) => s.createdCardIds.push(payload.cardId));

  await expect
    .poll(
      async () => {
        const fetched = await apiFetch(`/v1/cards/${payload.cardId}`, apiKey);
        if (!fetched.ok) {
          return null;
        }
        return (await fetched.json()).type;
      },
      { timeout: 30_000, intervals: [1000, 2000, 3000, 5000] }
    )
    .toBe("palette");
});
