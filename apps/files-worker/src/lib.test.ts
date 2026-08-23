import { describe, expect, test } from "bun:test";
import {
  buildOpSigningPayload,
  buildSigningPayload,
  hmacSha256Hex,
  parseSingleByteRange,
  verifySignedFileRequest,
  verifySignedOpRequest,
} from "./lib";

const SECRET = "test-signing-secret";
const KEY = "users/abc/cards/file/x.png";
const EXP = "1700000000";

// Fixed vector shared with packages/convex/storage/r2.test.ts — proves the
// Node/Bun (Convex) and workerd (this worker) HMAC implementations agree.
const VECTOR_DIGEST =
  "f5791c418001f789e1507cfbb9b2be726feef0b7250c29849f5b5e88a6d1a9ce";

describe("files proxy signing", () => {
  test("matches the shared cross-runtime test vector", async () => {
    const digest = await hmacSha256Hex(
      SECRET,
      buildSigningPayload({
        key: KEY,
        exp: EXP,
        contentType: "image/png",
        contentDisposition: "inline",
      })
    );
    expect(digest).toBe(VECTOR_DIGEST);
  });

  test("omitting optional fields signs the empty-string slots", async () => {
    const withFields = await hmacSha256Hex(
      SECRET,
      buildSigningPayload({
        key: KEY,
        exp: EXP,
        contentType: "image/png",
        contentDisposition: "inline",
      })
    );
    const withoutFields = await hmacSha256Hex(
      SECRET,
      buildSigningPayload({ key: KEY, exp: EXP })
    );
    expect(withoutFields).not.toBe(withFields);
    expect(withoutFields).toHaveLength(64);
  });
});

describe("files proxy verification", () => {
  const params = {
    key: KEY,
    exp: EXP,
    sig: VECTOR_DIGEST,
    ct: "image/png",
    cd: "inline",
  };

  test("accepts a valid unexpired token", async () => {
    const result = await verifySignedFileRequest(SECRET, params, 1_699_999_999);
    expect(result).toEqual({ ok: true });
  });

  test("rejects expired tokens", async () => {
    const result = await verifySignedFileRequest(
      SECRET,
      { ...params, exp: "1700000001" },
      1_700_000_002
    );
    expect(result).toEqual({ ok: false, status: 410 });
  });

  test("rejects tampered signatures", async () => {
    for (const tampered of [
      { ...params, sig: `${VECTOR_DIGEST.slice(0, -1)}0` },
      { ...params, ct: "text/html" },
      { ...params, cd: "attachment" },
      { ...params, key: "users/other/cards/file/y.png" },
    ]) {
      const result = await verifySignedFileRequest(
        SECRET,
        tampered,
        1_699_999_999
      );
      expect(result).toEqual({ ok: false, status: 403 });
    }
  });

  test("rejects missing or malformed parameters", async () => {
    expect(
      await verifySignedFileRequest(SECRET, { key: "", exp: EXP, sig: "00" })
    ).toEqual({ ok: false, status: 401 });
    expect(
      await verifySignedFileRequest(SECRET, { key: KEY, exp: null, sig: "00" })
    ).toEqual({ ok: false, status: 401 });
    expect(
      await verifySignedFileRequest(SECRET, { key: KEY, exp: EXP, sig: null })
    ).toEqual({ ok: false, status: 401 });
    expect(
      await verifySignedFileRequest(SECRET, {
        key: KEY,
        exp: "nope",
        sig: "00",
      })
    ).toEqual({ ok: false, status: 403 });
    expect(
      await verifySignedFileRequest(SECRET, {
        key: KEY,
        exp: "0x10",
        sig: "zz",
      })
    ).toEqual({ ok: false, status: 403 });
  });
});

describe("range header parsing", () => {
  test("returns null for absent or ignored headers", () => {
    expect(parseSingleByteRange(null)).toBeNull();
    expect(parseSingleByteRange(undefined)).toBeNull();
    // Multi-range and non-byte units are ignored, not rejected.
    expect(parseSingleByteRange("bytes=0-1,5-9")).toBeNull();
    expect(parseSingleByteRange("items=0-5")).toBeNull();
    expect(parseSingleByteRange("bytes=")).toBeNull();
    expect(parseSingleByteRange("bytes=-")).toBeNull();
    expect(parseSingleByteRange("bytes=9-5")).toBeNull();
    expect(parseSingleByteRange("bytes=abc-def")).toBeNull();
    expect(parseSingleByteRange("bytes=-0")).toBeNull();
  });

  test("parses start-end ranges into offset+length", () => {
    expect(parseSingleByteRange("bytes=0-0")).toEqual({
      kind: "offset",
      offset: 0,
      length: 1,
    });
    expect(parseSingleByteRange("bytes=10-19")).toEqual({
      kind: "offset",
      offset: 10,
      length: 10,
    });
    expect(parseSingleByteRange(" bytes=100-200 ")).toEqual({
      kind: "offset",
      offset: 100,
      length: 101,
    });
  });

  test("parses open-ended and suffix ranges", () => {
    expect(parseSingleByteRange("bytes=500-")).toEqual({
      kind: "offset",
      offset: 500,
    });
    expect(parseSingleByteRange("bytes=-256")).toEqual({
      kind: "suffix",
      suffix: 256,
    });
  });
});

describe("op signing", () => {
  const OP_KEY = "users/abc/cards/file/x.png";
  const OP_DEST = "users/abc/cards/thumbnail/t.webp";

  // Fixed vector shared with packages/convex/__tests__/storage/r2.test.ts —
  // proves Node/Bun (Convex) and workerd (worker) agree on op payloads.
  const OP_VECTOR_DIGEST =
    "08bf451235a9af51ddc744b0b7be67622a06dc36696f87675fda746fc8efae47";

  test("op payload format matches the shared cross-runtime vector", async () => {
    const digest = await hmacSha256Hex(
      SECRET,
      buildOpSigningPayload({
        op: "process-image",
        key: OP_KEY,
        fields: [OP_DEST],
        exp: EXP,
      })
    );
    expect(digest).toBe(OP_VECTOR_DIGEST);
  });

  test("accepts a valid unexpired op token", async () => {
    const sig = await hmacSha256Hex(
      SECRET,
      buildOpSigningPayload({
        op: "inspect",
        key: OP_KEY,
        fields: ["zip", String(25 * 1024 * 1024), ""],
        exp: EXP,
      })
    );
    expect(
      await verifySignedOpRequest(
        SECRET,
        "inspect",
        OP_KEY,
        { fields: ["zip", String(25 * 1024 * 1024), ""], exp: EXP, sig },
        1_699_999_999
      )
    ).toEqual({ ok: true });
  });

  test("rejects expired, tampered, over-long-ttl, and malformed tokens", async () => {
    const sig = await hmacSha256Hex(
      SECRET,
      buildOpSigningPayload({
        op: "process-image",
        key: OP_KEY,
        fields: [OP_DEST],
        exp: EXP,
      })
    );
    const params = { fields: [OP_DEST], exp: EXP, sig };

    expect(
      await verifySignedOpRequest(
        SECRET,
        "process-image",
        OP_KEY,
        params,
        1_700_000_001
      )
    ).toEqual({ ok: false, status: 410 });
    // Wrong op name is a signature mismatch (checked before expiry).
    expect(
      await verifySignedOpRequest(
        SECRET,
        "build-export",
        OP_KEY,
        params,
        1_699_999_999
      )
    ).toEqual({ ok: false, status: 403 });
    expect(
      await verifySignedOpRequest(
        SECRET,
        "process-image",
        "other/key.png",
        params,
        1_699_999_999
      )
    ).toEqual({ ok: false, status: 403 });
    expect(
      await verifySignedOpRequest(
        SECRET,
        "process-image",
        OP_KEY,
        {
          ...params,
          fields: ["users/other/t.webp"],
        },
        1_699_999_999
      )
    ).toEqual({ ok: false, status: 403 });

    // Op URLs must be short-lived: mint-time TTL is bounded.
    const farFuture = String(1_699_999_990 + 60 * 60 * 24);
    const farSig = await hmacSha256Hex(
      SECRET,
      buildOpSigningPayload({
        op: "process-image",
        key: OP_KEY,
        fields: [OP_DEST],
        exp: farFuture,
      })
    );
    expect(
      await verifySignedOpRequest(
        SECRET,
        "process-image",
        OP_KEY,
        {
          fields: [OP_DEST],
          exp: farFuture,
          sig: farSig,
        },
        1_699_999_990 + 60
      )
    ).toEqual({ ok: false, status: 403 });

    expect(
      await verifySignedOpRequest(SECRET, "process-image", OP_KEY, {
        fields: [OP_DEST],
        exp: null,
        sig,
      })
    ).toEqual({ ok: false, status: 401 });
    expect(
      await verifySignedOpRequest(SECRET, "process-image", OP_KEY, {
        fields: [OP_DEST],
        exp: "12",
        sig: null,
      })
    ).toEqual({ ok: false, status: 401 });
  });
});
