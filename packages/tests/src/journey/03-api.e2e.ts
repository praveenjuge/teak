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
