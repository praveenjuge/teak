import { describe, expect, test } from "bun:test";
import {
  checkSignedExpiry,
  FILES_MULTIPART_MAX_PARTS,
  FILES_MULTIPART_PART_PATH,
  FILES_MULTIPART_SIZED_URL_MAX_TTL_SECONDS,
  FILES_MULTIPART_URL_MAX_TTL_SECONDS,
  FILES_NETWORK_OPS,
  FILES_OP_MAX_TTL_SECONDS,
  FILES_WORKER_OPS,
  FilesOpError,
  filesErrorEnvelope,
  filesOpErrorCode,
  filesSuccessEnvelope,
  hexDigestsMatch,
  isSameUserNamespace,
  isValidObjectKey,
  MULTIPART_PART_ROUTE,
  parseFilesKeyPrefix,
  readFilesOpOutcome,
  SIGNED_REQUEST_HEADERS,
  signDispatchProof,
  signFilesOpRequest,
  signMultipartPartUrl,
  signUploadUrl,
  signWorkflowRpcRequest,
  verifyDispatchProof,
  verifyFilesOpRequest,
  verifyMultipartPartUrl,
  verifyUploadUrl,
  verifyWorkflowRpcRequest,
} from "./index";

const SECRET = "test-secret";
const BASE = "https://files.example";
const NOW = 1_800_000_000;
const KEY = "users/abc/cards/c1/file/a.png";

describe("signature primitives", () => {
  test("compares hex digests whatever their case, never across lengths", () => {
    expect(hexDigestsMatch("ab12", "AB12")).toBe(true);
    expect(hexDigestsMatch("ab12", "ab13")).toBe(false);
    expect(hexDigestsMatch("ab1", "ab12")).toBe(false);
    expect(hexDigestsMatch("zz12", "zz12")).toBe(false);
  });

  test.each([
    [String(NOW + 60), 300, "valid"],
    [String(NOW + 60), null, "valid"],
    [String(NOW - 1), 300, "expired"],
    [String(NOW + 301), 300, "too_far"],
    [`${NOW + 60}.0`, 300, "malformed"],
    ["0123", 300, "malformed"],
    ["soon", 300, "malformed"],
  ] as const)("expiry %s within %p is %s", (expiresAt, ttl, expected) => {
    expect(checkSignedExpiry(expiresAt, ttl, NOW)).toBe(expected);
  });
});

describe("op requests", () => {
  const sign = () =>
    signFilesOpRequest(
      {
        base: `${BASE}/`,
        op: "inspect",
        params: { mode: "text" },
        secret: SECRET,
      },
      NOW
    );

  test("the Worker accepts what Convex signs", async () => {
    const signed = await sign();
    expect(signed.url).toBe(`${BASE}/__ops/v1`);
    expect(
      await verifyFilesOpRequest(
        SECRET,
        new Headers(signed.headers),
        signed.body,
        NOW
      )
    ).toEqual({ ok: true });
  });

  test("refuses a changed body, another secret, a stale or missing signature", async () => {
    const signed = await sign();
    const headers = new Headers(signed.headers);
    expect(
      await verifyFilesOpRequest(SECRET, headers, `${signed.body} `, NOW)
    ).toMatchObject({ code: "AUTH_INVALID", status: 403 });
    expect(
      await verifyFilesOpRequest("other", headers, signed.body, NOW)
    ).toMatchObject({ code: "AUTH_INVALID", status: 403 });
    expect(
      await verifyFilesOpRequest(
        SECRET,
        headers,
        signed.body,
        NOW + FILES_OP_MAX_TTL_SECONDS
      )
    ).toMatchObject({ code: "AUTH_EXPIRED", status: 410 });
    headers.delete(SIGNED_REQUEST_HEADERS.signature);
    expect(
      await verifyFilesOpRequest(SECRET, headers, signed.body, NOW)
    ).toMatchObject({ code: "AUTH_INVALID", status: 401 });
  });

  test("Convex calls only network ops; the Worker keeps its own", () => {
    const network = new Set<string>(FILES_NETWORK_OPS);
    expect(FILES_WORKER_OPS.filter((op) => network.has(op))).toEqual([]);
  });
});

describe("single-file upload URLs", () => {
  test("binds the type and size it was signed with", async () => {
    const { url } = await signUploadUrl(
      {
        base: BASE,
        contentType: "image/png",
        key: KEY,
        secret: SECRET,
        size: 9,
      },
      NOW
    );
    expect(
      await verifyUploadUrl(SECRET, new URL(url), "text/plain", NOW)
    ).toEqual({ contentType: "image/png", key: KEY, ok: true, size: 9 });
    const forged = new URL(url);
    forged.searchParams.set("sz", "10");
    expect(
      await verifyUploadUrl(SECRET, forged, "image/png", NOW)
    ).toMatchObject({ code: "AUTH_INVALID", ok: false, status: 403 });
  });

  test("an unbound type takes the request's own", async () => {
    const { url } = await signUploadUrl(
      { base: BASE, contentType: null, key: KEY, secret: SECRET },
      NOW
    );
    expect(
      await verifyUploadUrl(SECRET, new URL(url), "Image/JPEG; q=1", NOW)
    ).toMatchObject({ contentType: "image/jpeg", ok: true, size: null });
    expect(
      await verifyUploadUrl(SECRET, new URL(url), null, NOW)
    ).toMatchObject({ code: "INVALID_INPUT", status: 400 });
  });

  test("reads a request type as type/subtype, ignoring its parameters", async () => {
    const { url } = await signUploadUrl(
      { base: BASE, contentType: null, key: KEY, secret: SECRET },
      NOW
    );
    const verdict = async (type: string) =>
      (await verifyUploadUrl(SECRET, new URL(url), type, NOW)).ok;
    expect(await verdict("text/plain")).toBe(true);
    expect(await verdict("text/plain ;charset=utf-8")).toBe(true);
    expect(await verdict("Text/Plain; a=1\nb=2")).toBe(true);
    expect(await verdict("text")).toBe(false);
    expect(await verdict("te xt/plain")).toBe(false);
    expect(await verdict("text/pl@in")).toBe(false);
    expect(await verdict(`text/${"a".repeat(260)}`)).toBe(false);
  });

  test("refuses keys outside the user and export roots, and long lives", async () => {
    const { url } = await signUploadUrl(
      {
        base: BASE,
        contentType: null,
        key: "secrets/x",
        secret: SECRET,
      },
      NOW
    );
    expect(
      await verifyUploadUrl(SECRET, new URL(url), "text/plain", NOW)
    ).toMatchObject({ code: "INVALID_INPUT", status: 400 });
    await expect(
      signUploadUrl(
        {
          base: BASE,
          contentType: null,
          key: KEY,
          secret: SECRET,
          ttlSeconds: 3600,
        },
        NOW
      )
    ).rejects.toThrow("invalid_upload_ttl");
  });
});

describe("multipart part URLs", () => {
  test("the part route is the part path", () => {
    const route = MULTIPART_PART_ROUTE.exec(
      `${FILES_MULTIPART_PART_PATH}/upload%2F1/7`
    );
    expect(route?.slice(1)).toEqual(["upload%2F1", "7"]);
    expect(MULTIPART_PART_ROUTE.test(`${FILES_MULTIPART_PART_PATH}/u/x`)).toBe(
      false
    );
  });

  const part = (args: {
    partNumber?: number;
    size?: number | null;
    ttlSeconds?: number;
  }) =>
    signMultipartPartUrl(
      {
        base: BASE,
        key: KEY,
        partNumber: args.partNumber ?? 1,
        secret: SECRET,
        size: args.size ?? null,
        ttlSeconds: args.ttlSeconds,
        uploadId: "up/1",
      },
      NOW
    );

  test("the Worker accepts what Convex signs", async () => {
    const url = await part({ partNumber: 3 });
    expect(await verifyMultipartPartUrl(SECRET, new URL(url), NOW)).toEqual({
      key: KEY,
      ok: true,
      partNumber: 3,
      size: null,
      uploadId: "up/1",
    });
  });

  test("Convex and the Worker share the part and lifetime limits", async () => {
    await expect(
      part({ partNumber: FILES_MULTIPART_MAX_PARTS + 1 })
    ).rejects.toThrow("invalid_multipart_capability");
    await expect(
      part({ ttlSeconds: FILES_MULTIPART_URL_MAX_TTL_SECONDS + 1 })
    ).rejects.toThrow("invalid_multipart_capability");
    const sized = await part({
      size: 64 * 1024 * 1024,
      ttlSeconds: FILES_MULTIPART_SIZED_URL_MAX_TTL_SECONDS,
    });
    expect(
      await verifyMultipartPartUrl(SECRET, new URL(sized), NOW)
    ).toMatchObject({ ok: true, size: 64 * 1024 * 1024 });
  });

  test("refuses a part number past the limit even when signed", async () => {
    const url = new URL(await part({ partNumber: 1 }));
    url.pathname = url.pathname.replace(/\/1$/u, "/101");
    expect(await verifyMultipartPartUrl(SECRET, url, NOW)).toMatchObject({
      ok: false,
      status: 403,
    });
  });
});

describe("workflow RPC and dispatch proofs", () => {
  const SITE = "https://prod.convex.site";

  test("Convex accepts what the Worker signs, for its own deployment only", async () => {
    const body = JSON.stringify({ args: {}, kind: "query", name: "a:b" });
    const { headers, url } = await signWorkflowRpcRequest(
      { body, convexSiteUrl: SITE, secret: SECRET },
      NOW
    );
    expect(url).toBe(`${SITE}/__workflow/v1`);
    expect(
      await verifyWorkflowRpcRequest(
        SECRET,
        SITE,
        new Headers(headers),
        body,
        NOW
      )
    ).toBe(true);
    expect(
      await verifyWorkflowRpcRequest(
        SECRET,
        "https://dev.convex.site",
        new Headers(headers),
        body,
        NOW
      )
    ).toBe(false);
  });

  test("a dispatch proof covers its exact items", async () => {
    const items = [{ keys: [KEY], type: "delete-objects" }];
    const proof = await signDispatchProof(
      { convexSiteUrl: SITE, items, secret: SECRET },
      NOW
    );
    expect(
      await verifyDispatchProof(SECRET, SITE, { ...proof, items }, NOW)
    ).toBe(true);
    expect(
      await verifyDispatchProof(
        SECRET,
        SITE,
        { ...proof, items: [...items, ...items] },
        NOW
      )
    ).toBe(false);
  });
});

describe("op outcomes", () => {
  test("reads a result, a decline and a failure the same way on both sides", () => {
    expect(
      readFilesOpOutcome(filesSuccessEnvelope("r", { a: 1 }), 200)
    ).toEqual({ data: { a: 1 }, kind: "ok" });
    expect(
      readFilesOpOutcome(
        filesErrorEnvelope({
          code: "NOT_FOUND",
          message: "gone",
          requestId: "r",
        }),
        404
      )
    ).toEqual({ code: "NOT_FOUND", kind: "declined", message: "gone" });
    const conflict = filesErrorEnvelope({
      code: "CONFLICT",
      message: "changed",
      requestId: "r",
    });
    expect(readFilesOpOutcome(conflict, 409, ["CONFLICT"])).toMatchObject({
      kind: "declined",
    });
    expect(() => readFilesOpOutcome(conflict, 409)).toThrow(
      "files_worker_error:CONFLICT:409:r"
    );
  });

  test("a failure carries its code, even once only its message is left", () => {
    let failure: unknown;
    try {
      readFilesOpOutcome(
        filesErrorEnvelope({
          aiFacts: {
            usage: { inputTokens: 3, outputTokens: 1 },
            validationRetryCount: 0,
          },
          code: "AI_CAPACITY",
          message: "busy",
          requestId: "r",
        }),
        429
      );
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(FilesOpError);
    expect(filesOpErrorCode(failure)).toBe("AI_CAPACITY");
    expect((failure as FilesOpError).aiFacts?.usage).toEqual({
      inputTokens: 3,
      outputTokens: 1,
    });
    expect(
      filesOpErrorCode(
        new Error(`NonRetryableError: ${(failure as Error).message}`)
      )
    ).toBe("AI_CAPACITY");
    expect(filesOpErrorCode(new Error("rate limit reached 429"))).toBeNull();
  });

  test("an unreadable answer is a retryable internal failure", () => {
    let failure: unknown;
    try {
      readFilesOpOutcome(null, 502);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: "INTERNAL", retryable: true });
  });
});

describe("object keys", () => {
  test.each([
    ["", ""],
    ["dev", "dev/"],
    [" /dev/ ", "dev/"],
    [undefined, ""],
  ] as const)("reads R2_KEY_PREFIX %p as %p", (raw, expected) => {
    expect(parseFilesKeyPrefix(raw)).toBe(expected);
  });

  test("refuses a prefix the Worker would not serve", () => {
    expect(() => parseFilesKeyPrefix("staging/")).toThrow(
      "invalid_r2_key_prefix"
    );
  });

  test("tells one user's keys from another's in either deployment", () => {
    expect(
      isSameUserNamespace("users/abc/cards/a", "dev/users/abc/cards/b")
    ).toBe(true);
    expect(isSameUserNamespace("users/abc/cards/a", "users/abd/cards/a")).toBe(
      false
    );
    expect(isSameUserNamespace("exports/abc/a", "exports/abc/b")).toBe(false);
  });

  test("accepts keys only under known roots, without traversal", () => {
    expect(isValidObjectKey(KEY)).toBe(true);
    expect(isValidObjectKey("dev/exports/x.zip")).toBe(true);
    expect(isValidObjectKey("users/abc/../x")).toBe(false);
    expect(isValidObjectKey("users//x")).toBe(false);
    expect(isValidObjectKey("tmp/x")).toBe(false);
  });
});
