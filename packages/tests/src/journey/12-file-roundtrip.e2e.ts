import { Buffer } from "node:buffer";
import { expect, test } from "@playwright/test";
import { apiFetch } from "../helpers/api";
import { requireServiceApiKey, updateState } from "../helpers/run-state";

const makePng = (): Uint8Array => {
  // 1x1 transparent PNG.
  return Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64"
    )
  );
};

test("REST file upload round-trips through the Files Worker and deletion is durable", async () => {
  test.setTimeout(120_000);
  const apiKey = requireServiceApiKey("api");
  const bytes = makePng();
  const fileName = `worker-roundtrip-${Date.now()}.png`;

  // 1. Prepare a signed upload through the Files Worker.
  const prepared = await apiFetch("/v1/uploads", apiKey, {
    method: "POST",
    body: JSON.stringify({
      fileName,
      fileSize: bytes.byteLength,
      mimeType: "image/png",
    }),
  });
  expect(prepared.status).toBe(200);
  const upload = (await prepared.json()) as {
    fileKey: string;
    uploadUrl: string;
  };
  expect(upload.fileKey).toBeTruthy();
  expect(upload.uploadUrl).toContain("/__upload/v1/");

  // 2. PUT the bytes with the exact bound size and content type.
  const put = await fetch(upload.uploadUrl, {
    body: Uint8Array.from(bytes).buffer,
    headers: { "Content-Type": "image/png" },
    method: "PUT",
  });
  expect(put.ok).toBe(true);
  const etag = put.headers.get("etag");
  expect(etag).toBeTruthy();

  // 3. Replay the same PUT — content-immutable storage must accept it.
  const replay = await fetch(upload.uploadUrl, {
    body: Uint8Array.from(bytes).buffer,
    headers: { "Content-Type": "image/png" },
    method: "PUT",
  });
  expect(replay.ok).toBe(true);

  // 4. Create the card and wait for processing to expose URLs.
  const created = await apiFetch("/v1/cards", apiKey, {
    method: "POST",
    body: JSON.stringify({
      cardType: "image",
      fileEtag: etag,
      fileKey: upload.fileKey,
      fileName,
      fileSize: bytes.byteLength,
      mimeType: "image/png",
      source: "prod-e2e-worker-roundtrip",
      tags: ["prod-e2e", "worker-roundtrip"],
    }),
  });
  expect(created.status).toBe(200);
  const { cardId } = (await created.json()) as { cardId: string };
  updateState((state) => state.createdCardIds.push(cardId));

  let fileUrl = "";
  await expect
    .poll(async () => {
      const response = await apiFetch(`/v1/cards/${cardId}`, apiKey);
      if (!response.ok) {
        return false;
      }
      const card = (await response.json()) as { fileUrl?: string };
      fileUrl = card.fileUrl ?? "";
      return Boolean(fileUrl);
    })
    .toBe(true);

  // 5. The served bytes round-trip exactly through the worker.
  const download = await fetch(fileUrl);
  expect(download.ok).toBe(true);
  expect(download.headers.get("content-type")).toBe("image/png");
  const downloaded = new Uint8Array(await download.arrayBuffer());
  expect(Buffer.from(downloaded).equals(Buffer.from(bytes))).toBe(true);

  // 6. Deleting the card trashes it: the REST surface stops serving it.
  // (Stored objects are purged later by the durable cleanup workflows.)
  const deleted = await apiFetch(`/v1/cards/${cardId}`, apiKey, {
    method: "DELETE",
  });
  expect(deleted.status).toBe(200);

  await expect
    .poll(async () => {
      const response = await apiFetch(`/v1/cards/${cardId}`, apiKey);
      return response.status;
    })
    .toBe(404);
});
