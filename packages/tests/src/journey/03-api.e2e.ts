import { expect, test } from "@playwright/test";
import { apiFetch, loadOpenApi } from "../helpers/api";
import { expandedFileFixtures } from "../helpers/file-formats";
import { requireServiceApiKey, updateState } from "../helpers/run-state";

test("REST API happy paths and OpenAPI contracts", async () => {
  const apiKey = requireServiceApiKey("api");
  const openapi = await loadOpenApi();
  for (const path of [
    "/v1/cards",
    "/v1/cards/search",
    "/v1/cards/favorites",
    "/v1/tags",
  ]) {
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
      content: `api-prod-e2e-${Date.now()}`,
      tags: ["prod-e2e"],
      source: "prod-e2e",
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
  expect(
    (
      await apiFetch(cardPath, apiKey, {
        method: "PATCH",
        body: JSON.stringify({ notes: "updated by prod e2e" }),
      })
    ).status
  ).toBe(200);
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
      tags: ["prod-e2e"],
      source: "prod-e2e",
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

test("saving a color as content creates a palette card, not a text card", async () => {
  // Regression: saving a color (single hex, or a list of colors/names) as card
  // content stopped becoming a "palette" card and stuck as "text". Palette
  // classification runs asynchronously after creation, so poll until it lands.
  const apiKey = requireServiceApiKey("api");
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

test("REST API uploads and infers the expanded file-format matrix", async () => {
  const apiKey = requireServiceApiKey("api");
  const marker = `api-file-${Date.now()}`;
  const fixtures = expandedFileFixtures(marker);

  for (const [index, fixture] of fixtures.entries()) {
    const prepared = await apiFetch("/v1/uploads", apiKey, {
      method: "POST",
      body: JSON.stringify({
        fileName: fixture.fileName,
        fileSize: fixture.bytes.byteLength,
        mimeType: fixture.mimeType,
      }),
    });
    expect(prepared.status, fixture.fileName).toBe(200);
    const upload = await prepared.json();
    expect(upload).toMatchObject({
      maxFileSize: 100 * 1024 * 1024,
      method: "PUT",
    });

    const put = await fetch(upload.uploadUrl, {
      body: Uint8Array.from(fixture.bytes).buffer,
      headers: { "Content-Type": fixture.mimeType },
      method: "PUT",
    });
    expect(put.ok, fixture.fileName).toBe(true);

    let explicitCardType: "document" | "image" | undefined;
    if (index === 1) {
      explicitCardType = fixture.mimeType.startsWith("image/")
        ? "image"
        : "document";
    }
    const created = await apiFetch("/v1/cards", apiKey, {
      method: "POST",
      body: JSON.stringify({
        ...(explicitCardType ? { cardType: explicitCardType } : {}),
        fileKey: upload.fileKey,
        fileName: fixture.fileName,
        fileSize: fixture.bytes.byteLength,
        mimeType: fixture.mimeType,
        source: "prod-e2e-file-formats",
        tags: ["prod-e2e", "file-formats"],
      }),
    });
    expect(created.status, fixture.fileName).toBe(200);
    const card = await created.json();
    updateState((state) => state.createdCardIds.push(card.cardId));

    const fetched = await apiFetch(`/v1/cards/${card.cardId}`, apiKey);
    expect(fetched.status).toBe(200);
    const fetchedCard = await fetched.json();
    expect(fetchedCard.fileName).toBe(fixture.fileName);
    expect(fetchedCard.fileKind).toBeTruthy();
    expect(fetchedCard.mimeType).toBe(fixture.mimeType);
    if (fixture.fileName.endsWith(".gif")) {
      expect(fetchedCard.type).toBe("video");
      expect(fetchedCard.filePreview?.animated).toBe(true);
    }
  }

  const unsupported = await apiFetch("/v1/uploads", apiKey, {
    method: "POST",
    body: JSON.stringify({
      fileName: `${marker}.riv`,
      fileSize: 4,
      mimeType: "application/octet-stream",
    }),
  });
  expect(unsupported.status).toBe(400);
});
