import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import {
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
    expect(exp).toBeGreaterThanOrEqual(before + 900);
    expect(exp).toBeLessThanOrEqual(after + 900);

    // No overrides -> no ct/cd params -> worker falls back to stored metadata.
    expect(url.searchParams.get("ct")).toBeNull();
    expect(url.searchParams.get("cd")).toBeNull();
    expect(url.searchParams.get("sig")).toBe(
      hmacHex(buildSignedFilePayload({ key: KEY, exp: `${exp}` }))
    );
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
