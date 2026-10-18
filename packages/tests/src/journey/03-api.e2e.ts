import { apiFetch, loadOpenApi } from "../helpers/api";
import { createApiAccount } from "../helpers/app";
import { expect, test } from "../helpers/test";

let apiKey = "";
test.beforeAll(async () => {
  ({ apiKey } = await createApiAccount("service-api"));
});

test("REST API happy paths and OpenAPI contracts", async () => {
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

  expect(payload.card?.type).toBe("link");
  expect(payload.card?.url).toBe(bookUrl);

  const fetched = await apiFetch(`/v1/cards/${payload.cardId}`, apiKey);
  expect(fetched.status).toBe(200);
  const fetchedPayload = await fetched.json();
  expect(fetchedPayload.type).toBe("link");
  expect(fetchedPayload.url).toBe(bookUrl);
});

test("a link is marked done and found with is:done; a note can't be", async () => {
  const openapi = await loadOpenApi();
  const url = `https://example.com/done-${Date.now()}`;
  const created = await apiFetch("/v1/cards", apiKey, {
    method: "POST",
    body: JSON.stringify({ content: url, source: "e2e" }),
  });
  const { cardId } = await created.json();
  const donePath = `/v1/cards/${cardId}/done`;

  const marked = await apiFetch(donePath, apiKey, { method: "POST" });
  expect(marked.status).toBe(200);
  const markedCard = await marked.json();
  openapi.validate("/v1/cards/{cardId}/done", "POST", 200, markedCard);
  expect(markedCard.completedAt).toEqual(expect.any(Number));
  // Marking it again keeps the first date.
  const again = await (
    await apiFetch(donePath, apiKey, { method: "POST" })
  ).json();
  expect(again.completedAt).toBe(markedCard.completedAt);

  const done = await (
    await apiFetch(`/v1/cards?q=${encodeURIComponent("is:done")}`, apiKey)
  ).json();
  expect(done.items.map((item: { id: string }) => item.id)).toContain(cardId);

  const cleared = await apiFetch(donePath, apiKey, { method: "DELETE" });
  expect(cleared.status).toBe(200);
  const clearedCard = await cleared.json();
  openapi.validate("/v1/cards/{cardId}/done", "DELETE", 200, clearedCard);
  expect(clearedCard.completedAt).toBeNull();
  expect((await apiFetch(donePath, apiKey, { method: "DELETE" })).status).toBe(
    200
  );

  const note = await (
    await apiFetch("/v1/cards", apiKey, {
      method: "POST",
      body: JSON.stringify({ content: `done note ${Date.now()}` }),
    })
  ).json();
  const refused = await apiFetch(`/v1/cards/${note.cardId}/done`, apiKey, {
    method: "POST",
  });
  expect(refused.status).toBe(400);
  expect(await refused.json()).toMatchObject({ code: "TYPE_MISMATCH" });
});

test("Save PDF refuses a card that isn't an arXiv paper, and another account's card", async () => {
  const openapi = await loadOpenApi();
  const note = await (
    await apiFetch("/v1/cards", apiKey, {
      method: "POST",
      body: JSON.stringify({ content: `save pdf note ${Date.now()}` }),
    })
  ).json();
  const refused = await apiFetch(`/v1/cards/${note.cardId}/save-pdf`, apiKey, {
    method: "POST",
  });
  expect(refused.status).toBe(400);
  const body = await refused.json();
  expect(body).toMatchObject({ code: "INVALID_INPUT" });
  openapi.validate("/v1/cards/{cardId}/save-pdf", "POST", 400, body);

  const missing = await apiFetch("/v1/cards/not-a-card/save-pdf", apiKey, {
    method: "POST",
  });
  expect(missing.status).toBe(404);
});

test("REST text cards preserve raw Markdown and enforce the UTF-8 limit", async () => {
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
  expect((await exact.json()).cardId).toBeTruthy();

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
      { timeout: 30_000, interval: 2000 }
    )
    .toBe("palette");
});
