import { Buffer } from "node:buffer";
import { expect, test } from "@playwright/test";
import { apiFetch } from "../helpers/api";
import { requireServiceApiKey, updateState } from "../helpers/run-state";

test("preview OCC harness keeps parallel card operations coherent", async () => {
  const apiKey = requireServiceApiKey("api");
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
  expect(creates.every((response) => response.status === 200)).toBe(true);
  const created = await Promise.all(creates.map((response) => response.json()));
  const cardIds = created.map((payload) => payload.cardId as string);
  updateState((state) => state.createdCardIds.push(...cardIds));

  const uploadBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );
  const prepared = await apiFetch("/v1/uploads", apiKey, {
    body: JSON.stringify({
      fileName: `${marker}.png`,
      fileSize: uploadBytes.byteLength,
      mimeType: "image/png",
    }),
    method: "POST",
  });
  expect(prepared.status).toBe(200);
  const upload = await prepared.json();
  const put = await fetch(upload.uploadUrl, {
    body: Uint8Array.from(uploadBytes).buffer,
    headers: { "Content-Type": "image/png" },
    method: "PUT",
  });
  expect(put.ok).toBe(true);
  const uploaded = await apiFetch("/v1/cards", apiKey, {
    body: JSON.stringify({
      cardType: "image",
      fileEtag: put.headers.get("etag"),
      fileKey: upload.fileKey,
      fileName: `${marker}.png`,
      fileSize: uploadBytes.byteLength,
      mimeType: "image/png",
    }),
    method: "POST",
  });
  expect(uploaded.status).toBe(200);
  const uploadedCard = await uploaded.json();
  updateState((state) => state.createdCardIds.push(uploadedCard.cardId));

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
          `/v1/cards/search?q=${encodeURIComponent(marker)}`,
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
  expect(deletions.every((response) => response.status === 200)).toBe(true);
});
