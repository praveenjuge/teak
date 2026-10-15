import { describe, expect, test } from "bun:test";
import { buildFileSigningPayload } from "@teak/files-protocol";
import { FILE_SIGNING_TEST_VECTOR } from "@teak/files-protocol/test-vectors";
import {
  hmacSha256Hex,
  parseSingleByteRange,
  verifySignedFileRequest,
} from "./lib";

const {
  secret: SECRET,
  key: KEY,
  exp: EXP,
  digest: VECTOR_DIGEST,
} = FILE_SIGNING_TEST_VECTOR;

describe("files proxy signing", () => {
  test("signs the same digest as Convex's Node HMAC for the shared test vector", async () => {
    const digest = await hmacSha256Hex(
      SECRET,
      buildFileSigningPayload({
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
      buildFileSigningPayload({
        key: KEY,
        exp: EXP,
        contentType: "image/png",
        contentDisposition: "inline",
      })
    );
    const withoutFields = await hmacSha256Hex(
      SECRET,
      buildFileSigningPayload({ key: KEY, exp: EXP })
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
