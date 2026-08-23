import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import {
  buildSignedWorkerOpPayload,
  buildSignedWorkerOpUrl,
} from "../../storage/filesWorkerClient";
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

describe("signed worker op urls", () => {
  const OP_KEY = "users/abc/cards/file/x.png";
  const OP_DEST = "users/abc/cards/thumbnail/t.webp";

  // Fixed vector shared with apps/files-worker/src/lib.test.ts — proves the
  // Node/Bun (Convex) and workerd (worker) HMAC implementations agree on the
  // op payload shape too.
  const OP_VECTOR_DIGEST =
    "08bf451235a9af51ddc744b0b7be67622a06dc36696f87675fda746fc8efae47";

  test("op payload format matches the shared cross-runtime vector", () => {
    const payload = buildSignedWorkerOpPayload({
      op: "process-image",
      key: OP_KEY,
      fields: [OP_DEST],
      exp: EXP,
    });
    expect(payload).toBe(`op\nprocess-image\n${OP_KEY}\n${OP_DEST}\n${EXP}`);
    expect(hmacHex(payload)).toBe(OP_VECTOR_DIGEST);
  });

  test("mints short-lived signed op urls with all params", async () => {
    process.env.FILES_BASE = BASE;
    process.env.FILES_SIGNING_SECRET = SECRET;
    try {
      const before = Math.floor(Date.now() / 1000);
      const rawUrl = await buildSignedWorkerOpUrl({
        op: "inspect",
        key: OP_KEY,
        params: {
          mode: "zip",
          mb: String(25 * 1024 * 1024),
          rtf: "",
          fmt: "word",
        },
      });
      const after = Math.floor(Date.now() / 1000);
      const url = new URL(rawUrl);

      expect(url.origin + url.pathname).toBe(`${BASE}/${OP_KEY}`);
      expect(url.searchParams.get("op")).toBe("inspect");
      expect(url.searchParams.get("mode")).toBe("zip");
      expect(url.searchParams.get("fmt")).toBe("word");
      // Empty-string slots may be omitted from the URL but stay signed.
      expect(url.searchParams.get("rtf")).toBeNull();

      const exp = Number.parseInt(url.searchParams.get("exp") ?? "", 10);
      expect(exp).toBeGreaterThan(before);
      expect(exp).toBeLessThanOrEqual(after + 10 * 60);

      expect(url.searchParams.get("sig")).toBe(
        hmacHex(
          buildSignedWorkerOpPayload({
            op: "inspect",
            key: OP_KEY,
            fields: ["zip", String(25 * 1024 * 1024), "", "word"],
            exp: `${exp}`,
          })
        )
      );
    } finally {
      delete process.env.FILES_BASE;
      delete process.env.FILES_SIGNING_SECRET;
    }
  });
});
