import { describe, expect, test } from "bun:test";
import {
  buildFilesOpSigningPayload,
  buildMultipartPartSigningPayload,
  FILES_PROTOCOL_VERSION,
} from "@teak/files-protocol";
import worker, { type Env } from "./index";
import { buildSigningPayload, hmacSha256Hex, sha256Hex } from "./lib";
import { FakeBucket, fakeHttpEtag, makePng } from "./testsupport";

const SECRET = "test-secret";

const env = (): Env =>
  ({
    BUCKET: new FakeBucket() as unknown as R2Bucket,
    FILES_SIGNING_SECRET: SECRET,
  }) as Env;

const signedUrl = async (
  path: string,
  params: Record<string, string> = {},
  expSecondsFromNow = 3600
): Promise<string> => {
  const url = new URL(`https://files.teakvault.com${path}`);
  const key = decodeURIComponent(path.replace(/^\/+/, ""));
  const exp = String(Math.floor(Date.now() / 1000) + expSecondsFromNow);
  const sig = await hmacSha256Hex(
    SECRET,
    buildSigningPayload({
      key,
      exp,
      contentType: params.ct ?? "",
      contentDisposition: params.cd ?? "",
    })
  );
  url.searchParams.set("exp", exp);
  url.searchParams.set("sig", sig);
  if (params.ct) {
    url.searchParams.set("ct", params.ct);
  }
  if (params.cd) {
    url.searchParams.set("cd", params.cd);
  }
  return url.toString();
};

const signedOpRequest = async (
  op:
    | "analyze-image"
    | "complete-multipart"
    | "create-multipart"
    | "finalize-upload",
  params: Record<string, unknown>,
  method = "POST"
): Promise<Request> => {
  const body = JSON.stringify({ op, params, version: FILES_PROTOCOL_VERSION });
  const requestId = crypto.randomUUID();
  const expiresAt = String(Math.floor(Date.now() / 1000) + 600);
  const bodySha256 = await sha256Hex(body);
  return new Request("https://files.teakvault.com/__ops/v1", {
    body,
    method,
    headers: {
      "content-type": "application/json",
      "x-teak-expires-at": expiresAt,
      "x-teak-request-id": requestId,
      "x-teak-signature": await hmacSha256Hex(
        SECRET,
        buildFilesOpSigningPayload({ bodySha256, expiresAt, requestId })
      ),
    },
  });
};

describe("files worker handler", () => {
  const seed = (env_: Env): void => {
    (env_.BUCKET as unknown as FakeBucket).objects.set(
      "users/u1/cards/f/x.png",
      {
        bytes: makePng(32, 32),
        httpMetadata: { contentType: "image/png" },
      }
    );
  };

  test("serves /__health without authentication", async () => {
    const response = await worker.fetch(
      new Request("https://files.teakvault.com/__health"),
      env(),
      { waitUntil: () => undefined } as never
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("rejects non-GET/HEAD methods and answers OPTIONS preflights", async () => {
    const ctx = { waitUntil: () => undefined } as never;
    const post = await worker.fetch(
      new Request("https://files.teakvault.com/x", { method: "POST" }),
      env(),
      ctx
    );
    expect(post.status).toBe(405);

    const options = await worker.fetch(
      new Request("https://files.teakvault.com/x", { method: "OPTIONS" }),
      env(),
      ctx
    );
    expect(options.status).toBe(204);
    expect(options.headers.get("access-control-allow-origin")).toBe("*");
  });

  test("rejects unsigned downloads", async () => {
    const response = await worker.fetch(
      new Request("https://files.teakvault.com/users/u1/cards/f/x.png"),
      env(),
      { waitUntil: () => undefined } as never
    );
    expect(response.status).toBe(401);
  });

  test("serves a correctly signed key containing consecutive dots", async () => {
    const env_ = env();
    const key = "users/u1/cards/f/design..final.png";
    (env_.BUCKET as unknown as FakeBucket).objects.set(key, {
      bytes: makePng(8, 8),
    });
    const response = await worker.fetch(
      new Request(await signedUrl(`/${key}`)),
      env_,
      { waitUntil: () => undefined } as never
    );
    expect(response.status).toBe(200);
  });

  test("allows mutating operations only through signed POST bodies", async () => {
    const env_ = env();
    const legacyHead = await worker.fetch(
      new Request(
        "https://files.teakvault.com/users/u/file.png?op=process-image",
        {
          method: "HEAD",
        }
      ),
      env_,
      { waitUntil: () => undefined } as never
    );
    expect(legacyHead.status).toBe(410);
    const post = await worker.fetch(
      await signedOpRequest("create-multipart", {
        contentType: "image/png",
        key: "users/u1/cards/upload/file.png",
      }),
      env_,
      { waitUntil: () => undefined } as never
    );
    expect(post.status).toBe(200);
    expect(await post.json()).toMatchObject({
      ok: true,
      data: { uploadId: expect.any(String) },
    });
  });

  test("returns a controlled fallback for missing image-analysis sources", async () => {
    const env_ = env();
    const response = await worker.fetch(
      await signedOpRequest("analyze-image", {
        sourceKey: "users/u1/cards/missing/file.jpg",
      }),
      env_,
      { waitUntil: () => undefined } as never
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: {
        code: "NOT_FOUND",
        message: "source_not_found",
        retryable: false,
      },
      ok: false,
      version: FILES_PROTOCOL_VERSION,
    });
  });

  test("returns typed errors for wrong internal API methods", async () => {
    for (const [path, allow] of [
      ["/__ops/v1", "POST"],
      ["/__uploads/v1/id/1", "PUT"],
    ] as const) {
      const response = await worker.fetch(
        new Request(`https://files.teakvault.com${path}`),
        env(),
        { waitUntil: () => undefined } as never
      );
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe(allow);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(await response.json()).toMatchObject({
        error: {
          code: "INVALID_INPUT",
          requestId: expect.any(String),
          retryable: false,
        },
        ok: false,
        version: FILES_PROTOCOL_VERSION,
      });
    }
  });

  test("rejects a signed operation when its body is modified", async () => {
    const request = await signedOpRequest("create-multipart", {
      key: "users/u1/cards/upload/file.png",
    });
    const tampered = new Request(request, {
      body: JSON.stringify({
        op: "create-multipart",
        params: { key: "users/other/cards/upload/file.png" },
        version: FILES_PROTOCOL_VERSION,
      }),
    });
    const response = await worker.fetch(tampered, env(), {
      waitUntil: () => undefined,
    } as never);
    expect(response.status).toBe(403);
  });

  test("streams a validated pending upload and preserves a Markdown BOM", async () => {
    const env_ = env();
    const bucket = env_.BUCKET as unknown as FakeBucket;
    const sourceKey = "users/u1/cards/upload-pending-v2/file/design..final.md";
    const destinationKey = "users/u1/cards/stored/file/design..final.md";
    const markdown = "\uFEFFHello worker";
    const bytes = new TextEncoder().encode(markdown);
    bucket.objects.set(sourceKey, {
      bytes,
      httpMetadata: { contentType: "text/markdown" },
    });
    const response = await worker.fetch(
      await signedOpRequest("finalize-upload", {
        destinationKey,
        expectedSize: bytes.byteLength,
        readText: true,
        sourceKey,
      }),
      env_,
      { waitUntil: () => undefined } as never
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        content: markdown,
        destinationKey,
        storedFileSize: bytes.byteLength,
      },
      ok: true,
    });
    // Convex deletes the pending object only after its card mutation succeeds,
    // so a failed database write can safely retry finalization.
    expect(bucket.objects.has(sourceKey)).toBe(true);
    expect(bucket.storedBytes(destinationKey)).toEqual(bytes);
  });

  test("uploads and idempotently completes a signed multipart upload", async () => {
    const env_ = env();
    const bucket = env_.BUCKET as unknown as FakeBucket;
    const key = "users/u1/cards/upload/large.bin";
    const multipart = bucket.createMultipartUpload(key);
    const partNumber = 1;
    const expiresAt = String(Math.floor(Date.now() / 1000) + 600);
    const url = new URL(
      `https://files.teakvault.com/__uploads/v1/${multipart.uploadId}/${partNumber}`
    );
    url.searchParams.set("key", key);
    url.searchParams.set("exp", expiresAt);
    url.searchParams.set(
      "sig",
      await hmacSha256Hex(
        SECRET,
        buildMultipartPartSigningPayload({
          expiresAt,
          key,
          partNumber,
          uploadId: multipart.uploadId,
        })
      )
    );
    const response = await worker.fetch(
      new Request(url, {
        body: new Blob(["hello"]),
        headers: { "content-length": "5" },
        method: "PUT",
      }),
      env_,
      { waitUntil: () => undefined } as never
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("etag")).toBe("etag-1");

    const completionParams = {
      expectedSize: 5,
      key,
      parts: [{ etag: "etag-1", partNumber }],
      uploadId: multipart.uploadId,
    };
    const completed = await worker.fetch(
      await signedOpRequest("complete-multipart", completionParams),
      env_,
      { waitUntil: () => undefined } as never
    );
    expect(completed.status).toBe(200);
    expect(await completed.json()).toMatchObject({
      data: { key, size: 5 },
      ok: true,
    });

    const retried = await worker.fetch(
      await signedOpRequest("complete-multipart", completionParams),
      env_,
      { waitUntil: () => undefined } as never
    );
    expect(retried.status).toBe(200);
    expect(await retried.json()).toMatchObject({
      data: { key, size: 5 },
      ok: true,
    });
  });

  test("returns a versioned error envelope for multipart failures", async () => {
    const response = await worker.fetch(
      new Request("https://files.teakvault.com/__uploads/v1/missing/1", {
        body: "part",
        method: "PUT",
      }),
      env(),
      { waitUntil: () => undefined } as never
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: {
        code: "AUTH_INVALID",
        requestId: expect.any(String),
        retryable: false,
      },
      ok: false,
      version: FILES_PROTOCOL_VERSION,
    });
  });

  test("requires a fixed-length multipart request body", async () => {
    const env_ = env();
    const bucket = env_.BUCKET as unknown as FakeBucket;
    const key = "users/u1/cards/upload/stream.bin";
    const multipart = bucket.createMultipartUpload(key);
    const partNumber = 1;
    const expiresAt = String(Math.floor(Date.now() / 1000) + 600);
    const url = new URL(
      `https://files.teakvault.com/__uploads/v1/${multipart.uploadId}/${partNumber}`
    );
    url.searchParams.set("key", key);
    url.searchParams.set("exp", expiresAt);
    url.searchParams.set(
      "sig",
      await hmacSha256Hex(
        SECRET,
        buildMultipartPartSigningPayload({
          expiresAt,
          key,
          partNumber,
          uploadId: multipart.uploadId,
        })
      )
    );
    const response = await worker.fetch(
      new Request(url, {
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("hello"));
            controller.close();
          },
        }),
        method: "PUT",
      }),
      env_,
      { waitUntil: () => undefined } as never
    );
    expect(response.status).toBe(411);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_INPUT", retryable: false },
      ok: false,
      version: FILES_PROTOCOL_VERSION,
    });
  });

  test("serves signed downloads with nosniff, length, etag, and CORS", async () => {
    const env_ = env();
    seed(env_);
    const response = await worker.fetch(
      new Request(await signedUrl("/users/u1/cards/f/x.png")),
      env_,
      { waitUntil: () => undefined } as never
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(Number(response.headers.get("content-length"))).toBeGreaterThan(0);
    expect(response.headers.get("etag")).toBe(fakeHttpEtag(makePng(32, 32)));
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cache-control")).toContain("private");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes.length).toBe(makePng(32, 32).length);
  });

  test("answers conditional requests with a bodyless 304", async () => {
    const env_ = env();
    seed(env_);
    const etag = fakeHttpEtag(makePng(32, 32));
    const response = await worker.fetch(
      new Request(await signedUrl("/users/u1/cards/f/x.png"), {
        headers: { "if-none-match": `"${etag.replace(/"/g, "")}"` },
      }),
      env_,
      { waitUntil: () => undefined } as never
    );
    expect(response.status).toBe(304);
    expect(response.headers.get("etag")).toBe(etag);
    expect(await response.text()).toBe("");
  });

  test("supports HEAD with identical headers and no body", async () => {
    const env_ = env();
    seed(env_);
    const response = await worker.fetch(
      new Request(await signedUrl("/users/u1/cards/f/x.png"), {
        method: "HEAD",
      }),
      env_,
      { waitUntil: () => undefined } as never
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(Number(response.headers.get("content-length"))).toBe(
      makePng(32, 32).length
    );
    expect(await response.text()).toBe("");
  });

  test("serves exact ranged responses for seeking", async () => {
    const env_ = env();
    seed(env_);
    const bytes = makePng(32, 32);
    const response = await worker.fetch(
      new Request(await signedUrl("/users/u1/cards/f/x.png"), {
        headers: { range: `bytes=4-${String(11)}` },
      }),
      env_,
      { waitUntil: () => undefined } as never
    );
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(
      `bytes 4-11/${String(bytes.length)}`
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      bytes.slice(4, 12)
    );
  });

  test("rejects out-of-bounds ranges with a proper 416", async () => {
    const env_ = env();
    seed(env_);
    const response = await worker.fetch(
      new Request(await signedUrl("/users/u1/cards/f/x.png"), {
        headers: { range: "bytes=99999-" },
      }),
      env_,
      { waitUntil: () => undefined } as never
    );
    expect(response.status).toBe(416);
  });
});
