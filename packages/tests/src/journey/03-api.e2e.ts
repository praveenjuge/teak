import { expect, test } from "@playwright/test";
import { apiFetch, loadOpenApi } from "../helpers/api";
import { requireServiceApiKey, updateState } from "../helpers/run-state";

test("REST API happy paths and OpenAPI contracts", async () => {
  const apiKey = requireServiceApiKey("api");
  const openapi = await loadOpenApi();
  for (const path of ["/v1/cards", "/v1/tags"]) {
    const response = await apiFetch(path, apiKey);
    expect(response.ok).toBe(true);
    openapi.validate(
      path,
      "GET",
      response.status,
      await response.clone().json()
    );
  }
  const created = await apiFetch("/v1/cards", apiKey, {
    method: "POST",
    body: JSON.stringify({
      content: `api-e2e-${Date.now()}`,
      tags: ["e2e"],
      source: "e2e",
    }),
  });
  const payload = await created.json();
  openapi.validate("/v1/cards", "POST", created.status, payload);
  const cardPath = `/v1/cards/${payload.cardId}`;
  expect((await apiFetch(cardPath, apiKey)).status).toBe(200);
  expect(
    (
      await apiFetch(`${cardPath}/favorite`, apiKey, {
        method: "PATCH",
        body: JSON.stringify({ isFavorited: true }),
      })
    ).status
  ).toBe(200);
  const titleUpdate = await apiFetch(cardPath, apiKey, {
    method: "PATCH",
    body: JSON.stringify({ metadataTitle: "  Native Mac title  " }),
  });
  expect(titleUpdate.status).toBe(200);
  expect(await titleUpdate.json()).toMatchObject({
    metadataTitle: "Native Mac title",
  });
  expect(
    (
      await apiFetch(cardPath, apiKey, {
        method: "PATCH",
        body: JSON.stringify({ notes: "updated by prod e2e" }),
      })
    ).status
  ).toBe(200);
  expect(await (await apiFetch(cardPath, apiKey)).json()).toMatchObject({
    metadataTitle: "Native Mac title",
    notes: "updated by prod e2e",
  });
  const clearedTitle = await apiFetch(cardPath, apiKey, {
    method: "PATCH",
    body: JSON.stringify({ metadataTitle: null }),
  });
  expect(clearedTitle.status).toBe(200);
  expect(await clearedTitle.json()).toMatchObject({ metadataTitle: null });
  expect(
    (
      await apiFetch("/v1/cards/bulk", apiKey, {
        method: "POST",
        body: JSON.stringify({
          operation: "create",
          items: [{ content: "bulk prod e2e" }],
        }),
      })
    ).status
  ).toBe(200);
  expect((await apiFetch("/v1/cards/not-a-card", apiKey)).status).toBe(404);
});

test("saving a URL as content creates a link card, not a text card", async () => {
  // Regression: a bare URL (e.g. a Goodreads book link) submitted as card
  // content was stored as a "text" card instead of being recognized as a link.
  const apiKey = requireServiceApiKey("api");
  const bookUrl =
    "https://www.goodreads.com/book/show/2767052-the-hunger-games";
  const created = await apiFetch("/v1/cards", apiKey, {
    method: "POST",
    body: JSON.stringify({
      content: bookUrl,
      tags: ["e2e"],
      source: "e2e",
    }),
  });
  expect(created.status).toBe(200);
  const payload = await created.json();

  // The create response should already reflect the link classification.
  expect(payload.card?.type).toBe("link");
  expect(payload.card?.url).toBe(bookUrl);

  // And it should persist as a link when fetched back.
  const fetched = await apiFetch(`/v1/cards/${payload.cardId}`, apiKey);
  expect(fetched.status).toBe(200);
  const fetchedPayload = await fetched.json();
  expect(fetchedPayload.type).toBe("link");
  expect(fetchedPayload.url).toBe(bookUrl);
});

test("REST text cards preserve raw Markdown and enforce the UTF-8 limit", async () => {
  const apiKey = requireServiceApiKey("api");
  const marker = `api-markdown-${Date.now()}`;
  const original = `\uFEFF  # ${marker}\r\n\r\n- [ ] task  \r\nhttps://example.com  `;
  const created = await apiFetch("/v1/cards", apiKey, {
    method: "POST",
    body: JSON.stringify({
      cardType: "text",
      content: original,
      tags: ["e2e", "markdown"],
    }),
  });
  expect(created.status).toBe(200);
  const createdCard = await created.json();
  updateState((state) => state.createdCardIds.push(createdCard.cardId));
  expect(createdCard.card).toMatchObject({
    content: original,
    type: "text",
  });

  const updated = `  ---\r\ntitle: ${marker}\r\n---\r\n\r\n| A | B |\r\n| - | - |\r\n`;
  const patched = await apiFetch(`/v1/cards/${createdCard.cardId}`, apiKey, {
    method: "PATCH",
    body: JSON.stringify({ content: updated }),
  });
  expect(patched.status).toBe(200);
  expect(await patched.json()).toMatchObject({
    content: updated,
    type: "text",
  });

  const listed = await apiFetch(
    `/v1/cards?include=content&q=${encodeURIComponent(marker)}`,
    apiKey
  );
  expect((await listed.json()).items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ content: updated, type: "text" }),
    ])
  );

  const exact = await apiFetch("/v1/cards", apiKey, {
    method: "POST",
    body: JSON.stringify({
      cardType: "text",
      content: "a".repeat(512 * 1024),
    }),
  });
  expect(exact.status).toBe(200);
  const exactCard = await exact.json();
  updateState((state) => state.createdCardIds.push(exactCard.cardId));

  const oversized = await apiFetch("/v1/cards", apiKey, {
    method: "POST",
    body: JSON.stringify({
      cardType: "text",
      content: `${"a".repeat(512 * 1024)}b`,
    }),
  });
  expect(oversized.status).toBe(400);
  expect(await oversized.json()).toMatchObject({ code: "CONTENT_TOO_LARGE" });
});

test("saving a color as content creates a palette card, not a text card", async () => {
  // Regression: saving a color (single hex, or a list of colors/names) as card
  // content stopped becoming a "palette" card and stuck as "text". Palette
  // classification runs asynchronously after creation, so poll until it lands.
  const apiKey = requireServiceApiKey("api");
  const created = await apiFetch("/v1/cards", apiKey, {
    method: "POST",
    body: JSON.stringify({
      content: "#2050D0",
      tags: ["e2e"],
      source: "e2e",
    }),
  });
  expect(created.status).toBe(200);
  const payload = await created.json();

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
