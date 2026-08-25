import { afterAll, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import {
  buildUploadSigningPayload,
  FILES_UPLOAD_MAX_TTL_SECONDS,
} from "@teak/files-protocol";
import {
  buildSignedWorkerUploadUrl,
  isFilesWorkerConfigured,
} from "../../storage/filesWorkerClient";

const SECRET = "test-signing-secret";
const BASE = "https://files.teakvault.com";
const KEY = "users/abc/cards/pending/file/uuid-note.txt";

const originalFilesBase = process.env.FILES_BASE;
const originalFilesSecret = process.env.FILES_SIGNING_SECRET;

afterAll(() => {
  if (originalFilesBase === undefined) {
    // biome-ignore lint/performance/noDelete: test env cleanup
    delete process.env.FILES_BASE;
  } else {
    process.env.FILES_BASE = originalFilesBase;
  }
  if (originalFilesSecret === undefined) {
    // biome-ignore lint/performance/noDelete: test env cleanup
    delete process.env.FILES_SIGNING_SECRET;
  } else {
    process.env.FILES_SIGNING_SECRET = originalFilesSecret;
  }
});

const hmacHex = (message: string): string =>
  createHmac("sha256", SECRET).update(message).digest("hex");

describe("signed worker upload urls", () => {
  test("binds content type, size, key, and expiry into one signature", async () => {
    process.env.FILES_BASE = BASE;
    process.env.FILES_SIGNING_SECRET = SECRET;
    const before = Math.floor(Date.now() / 1000);
    const signed = await buildSignedWorkerUploadUrl({
      contentType: "text/plain",
      key: KEY,
      size: 42,
    });
    const after = Math.floor(Date.now() / 1000);

    expect(signed.key).toBe(KEY);
    // Default TTL is 10 minutes, within the worker's 15-minute ceiling.
    expect(signed.expiresAt).toBeGreaterThanOrEqual(before + 599);
    expect(signed.expiresAt).toBeLessThanOrEqual(after + 601);

    const url = new URL(signed.url);
    expect(url.origin + url.pathname).toBe(
      `${BASE}/__upload/v1/${encodeURIComponent(KEY)}`
    );
    expect(url.searchParams.get("ct")).toBe("text/plain");
    expect(url.searchParams.get("sz")).toBe("42");
    expect(url.searchParams.get("exp")).toBe(String(signed.expiresAt));
    expect(url.searchParams.get("sig")).toBe(
      hmacHex(
        buildUploadSigningPayload({
          contentType: "text/plain",
          expiresAt: String(signed.expiresAt),
          key: KEY,
          size: 42,
        })
      )
    );
  });

  test("rejects TTLs beyond the protocol ceiling", async () => {
    process.env.FILES_BASE = BASE;
    process.env.FILES_SIGNING_SECRET = SECRET;
    await expect(
      buildSignedWorkerUploadUrl({
        contentType: "text/plain",
        key: KEY,
        ttlSeconds: FILES_UPLOAD_MAX_TTL_SECONDS + 1,
      })
    ).rejects.toThrow("invalid_upload_ttl");
  });

  test("reports missing configuration", async () => {
    const base = process.env.FILES_BASE;
    const secret = process.env.FILES_SIGNING_SECRET;
    // biome-ignore lint/performance/noDelete: env mutation is required here
    delete process.env.FILES_BASE;
    // biome-ignore lint/performance/noDelete: env mutation is required here
    delete process.env.FILES_SIGNING_SECRET;
    try {
      expect(isFilesWorkerConfigured()).toBe(false);
      await expect(
        buildSignedWorkerUploadUrl({ contentType: "text/plain", key: KEY })
      ).rejects.toThrow("files_worker_not_configured");
    } finally {
      if (base !== undefined) {
        process.env.FILES_BASE = base;
      }
      if (secret !== undefined) {
        process.env.FILES_SIGNING_SECRET = secret;
      }
    }
  });
});
