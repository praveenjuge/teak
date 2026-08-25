import { describe, expect, test } from "bun:test";
import { createHash, createHmac } from "node:crypto";
import {
  buildFilesOpSigningPayload,
  buildImageSigningPayload,
} from "@teak/files-protocol";
import { buildSignedWorkerOpRequest } from "../../storage/filesWorkerClient";
import {
  bucketedSignatureExpiry,
  buildSignedFilePayload,
  buildSignedWorkerFileUrl,
  buildSignedWorkerImageUrl,
  cardStorageObjectKeys,
} from "../../storage/r2";

const SECRET = "test-signing-secret";
const BASE = "https://files.teakvault.com";
const KEY = "users/abc/cards/file/x.png";
const EXP = "1700000000";

// Fixed vector shared with apps/files-worker/src/lib.test.ts — proves the
// Node/Bun (here) and workerd (worker) HMAC implementations agree.
const VECTOR_DIGEST =
  "f5791c418001f789e1507cfbb9b2be726feef0b7250c29849f5b5e88a6d1a9ce";

const hmacHex = (message: string): string =>
  createHmac("sha256", SECRET).update(message).digest("hex");

describe("signed worker file urls", () => {
  test("payload format matches the shared cross-runtime vector", () => {
    const payload = buildSignedFilePayload({
      key: KEY,
      exp: EXP,
      contentType: "image/png",
      contentDisposition: "inline",
    });
    expect(payload).toBe(`${KEY}\n${EXP}\nimage/png\ninline`);
    expect(hmacHex(payload)).toBe(VECTOR_DIGEST);
  });

  test("mints worker urls with valid signature and ttl", async () => {
    const before = Math.floor(Date.now() / 1000);
    const url = new URL(await buildSignedWorkerFileUrl(BASE, SECRET, KEY));
    const after = Math.floor(Date.now() / 1000);

    expect(url.origin + url.pathname).toBe(`${BASE}/${KEY}`);
    const exp = Number.parseInt(url.searchParams.get("exp") ?? "", 10);
    // Default validity is the full 7-day signature lifetime.
    expect(exp).toBeGreaterThanOrEqual(before + 604_800);
    expect(exp).toBeLessThanOrEqual(after + 604_800);

    // No overrides -> no ct/cd params -> worker falls back to stored metadata.
    expect(url.searchParams.get("ct")).toBeNull();
    expect(url.searchParams.get("cd")).toBeNull();
    expect(url.searchParams.get("sig")).toBe(
      hmacHex(buildSignedFilePayload({ key: KEY, exp: `${exp}` }))
    );
  });

  test("mints identical urls for repeated signing within one window", async () => {
    const first = await buildSignedWorkerFileUrl(BASE, SECRET, KEY);
    const second = await buildSignedWorkerFileUrl(BASE, SECRET, KEY);
    expect(second).toBe(first);
  });

  test("bucketed expiry stays constant per window with ample remaining ttl", () => {
    const windowSeconds = 6 * 60 * 60;
    const windowStart =
      Math.floor((Math.floor(Date.now() / 60_000) * 60) / windowSeconds) *
      windowSeconds;
    const inWindow = [
      windowStart,
      windowStart + 1,
      windowStart + windowSeconds - 1,
    ];
    const expiries = inWindow.map((now) => bucketedSignatureExpiry(now));
    expect(new Set(expiries).size).toBe(1);

    // Every minted URL stays valid for at least the full 7-day TTL.
    expect(expiries[0]).toBeGreaterThanOrEqual(
      windowStart + windowSeconds - 1 + 604_800
    );

    // Crossing into the next window mints a new (still valid) expiry.
    const nextWindow = bucketedSignatureExpiry(windowStart + windowSeconds);
    expect(nextWindow).toBe(expiries[0]! + windowSeconds);
  });

  test("signs content-type and disposition overrides into the token", async () => {
    const url = new URL(
      await buildSignedWorkerFileUrl(BASE, SECRET, KEY, {
        contentType: "application/pdf",
        contentDisposition: "attachment",
      })
    );
    const exp = url.searchParams.get("exp") ?? "";
    expect(url.searchParams.get("ct")).toBe("application/pdf");
    expect(url.searchParams.get("cd")).toBe("attachment");
    expect(url.searchParams.get("sig")).toBe(
      hmacHex(
        buildSignedFilePayload({
          key: KEY,
          exp,
          contentType: "application/pdf",
          contentDisposition: "attachment",
        })
      )
    );
  });
});

describe("card storage cleanup", () => {
  test("includes legacy derivatives, sidecars, and link-preview media once", () => {
    expect(
      cardStorageObjectKeys({
        fileKey: "file",
        previewKey: "preview",
        thumbnailKey: "thumbnail",
        metadata: {
          linkPreview: {
            imageStorageKey: "image",
            screenshotStorageKey: "screenshot",
            media: [{ storageKey: "image", posterStorageKey: "poster" }],
          },
        },
      })
    ).toEqual([
      "file",
      "file.processing.json",
      "thumbnail",
      "preview",
      "image",
      "screenshot",
      "poster",
    ]);
  });
});

describe("signed worker image urls", () => {
  test("mints a URL bound to its fixed rendition and encoded object key", async () => {
    const url = new URL(
      await buildSignedWorkerImageUrl(
        BASE,
        SECRET,
        KEY,
        "detail",
        1_800_000_000
      )
    );
    expect(url.pathname).toBe(`/__images/v1/detail/${encodeURIComponent(KEY)}`);
    expect(url.searchParams.get("exp")).toBe("1800000000");
    expect(url.searchParams.get("sig")).toBe(
      hmacHex(
        buildImageSigningPayload({
          expiresAt: "1800000000",
          key: KEY,
          rendition: "detail",
        })
      )
    );
  });
});

describe("signed worker op urls", () => {
  test("mints a short-lived POST request bound to its exact body", async () => {
    process.env.FILES_BASE = BASE;
    process.env.FILES_SIGNING_SECRET = SECRET;
    try {
      const now = 1_700_000_000;
      const request = await buildSignedWorkerOpRequest(
        {
          op: "inspect",
          params: {
            sourceKey: KEY,
            mode: "zip",
            maxBytes: 25 * 1024 * 1024,
            formatId: "word",
          },
        },
        now
      );
      expect(request.method).toBe("POST");
      expect(request.url).toBe(`${BASE}/__ops/v1`);
      const bodyHash = createHash("sha256").update(request.body).digest("hex");
      const requestId = request.headers["x-teak-request-id"] as string;
      const expiresAt = request.headers["x-teak-expires-at"] as string;
      expect(expiresAt).toBe(String(now + 10 * 60));
      expect(request.headers["x-teak-signature"]).toBe(
        hmacHex(
          buildFilesOpSigningPayload({
            bodySha256: bodyHash,
            expiresAt,
            requestId,
          })
        )
      );
    } finally {
      delete process.env.FILES_BASE;
      delete process.env.FILES_SIGNING_SECRET;
    }
  });
});
