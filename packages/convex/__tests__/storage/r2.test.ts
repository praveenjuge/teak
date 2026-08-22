import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import {
  bucketedSignatureExpiry,
  buildSignedFilePayload,
  buildSignedWorkerFileUrl,
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
      Math.floor(Math.floor(Date.now() / 60_000) * 60 / windowSeconds) *
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
