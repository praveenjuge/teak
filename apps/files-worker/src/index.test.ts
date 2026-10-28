import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  buildFileSigningPayload,
  buildFilesOpSigningPayload,
  buildMultipartPartSigningPayload,
  FILES_PROTOCOL_VERSION,
} from "@teak/files-protocol";
import worker, { type Env } from "./index";
import { hmacSha256Hex, sha256Hex } from "./lib";
import {
  FakeBucket,
  fakeHttpEtag,
  makePng,
  withObjectGates,
} from "./test/testsupport";

const SECRET = "test-secret";

const env = (): Env =>
  withObjectGates({
    BUCKET: new FakeBucket() as unknown as R2Bucket,
    FILES_SIGNING_SECRET: SECRET,
  }) as Env;

const signedUrl = async (
  path: string,
  params: { cd?: string; ct?: string } = {},
  expSecondsFromNow = 3600
): Promise<string> => {
  const url = new URL(`https://files.teakvault.com${path}`);
  const key = decodeURIComponent(path.replace(/^\/+/, ""));
  const exp = String(Math.floor(Date.now() / 1000) + expSecondsFromNow);
  const sig = await hmacSha256Hex(
    SECRET,
    buildFileSigningPayload({
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
    | "freeze-object"
    | "create-multipart"
    | "finalize-upload"
    | "inspect"
    | "list-objects",
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

  test("missing gate binding keeps health and preflight available but refuses storage", async () => {
    const missing = {
      BUCKET: new FakeBucket(),
      FILES_SIGNING_SECRET: SECRET,
    } as unknown as Env;
    const ctx = { waitUntil: () => undefined } as never;
    expect(
      (
        await worker.fetch(
          new Request("https://files.teakvault.com/__health"),
          missing,
          ctx
        )
      ).status
    ).toBe(200);
    expect(
      (
        await worker.fetch(
          new Request("https://files.teakvault.com/users/u1/file", {
            method: "OPTIONS",
          }),
          missing,
          ctx
        )
      ).status
    ).toBe(204);
    const response = await worker.fetch(
      new Request(await signedUrl("/users/u1/file")),
      missing,
      ctx
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "object_gate_not_configured",
    });
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

  test("rejects unsigned downloads without granting any origin access", async () => {
    const response = await worker.fetch(
      new Request("https://files.teakvault.com/users/u1/cards/f/x.png"),
      env(),
      { waitUntil: () => undefined } as never
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
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
    expect(legacyHead.status).toBe(401);
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

  test("lists objects under a prefix with pagination", async () => {
    const bucket = new FakeBucket();
    const envWithBucket = withObjectGates({
      BUCKET: bucket,
      FILES_SIGNING_SECRET: SECRET,
    }) as Env;
    for (const key of [
      "users/u1/cards/a/one",
      "users/u1/cards/b/two",
      "users/u1/cards/c/four",
      "users/u2/cards/c/three",
    ]) {
      bucket.objects.set(key, { bytes: new Uint8Array([1]) });
    }

    const pageOneResponse = await worker.fetch(
      await signedOpRequest("list-objects", {
        limit: 2,
        prefix: "users/u1/",
      }),
      envWithBucket,
      { waitUntil: () => undefined } as never
    );
    expect(pageOneResponse.status).toBe(200);
    const pageOne = (await pageOneResponse.json()) as {
      data: {
        cursor: string | null;
        objects: Array<{ key: string; size: number }>;
        truncated: boolean;
      };
      ok: boolean;
    };
    expect(pageOne.ok).toBe(true);
    expect(pageOne.data.objects.map((object) => object.key)).toEqual([
      "users/u1/cards/a/one",
      "users/u1/cards/b/two",
    ]);
    expect(pageOne.data.truncated).toBe(true);
    expect(pageOne.data.cursor).toBeTruthy();

    const pageTwoResponse = await worker.fetch(
      await signedOpRequest("list-objects", {
        cursor: pageOne.data.cursor as string,
        limit: 2,
        prefix: "users/u1/",
      }),
      envWithBucket,
      { waitUntil: () => undefined } as never
    );
    const pageTwo = (await pageTwoResponse.json()) as {
      data: { objects: Array<{ key: string }>; truncated: boolean };
    };
    expect(pageTwo.data.objects.map((object) => object.key)).toEqual([
      "users/u1/cards/c/four",
    ]);
    expect(pageTwo.data.truncated).toBe(false);
  });

  test("rejects list-objects with a non-users prefix", async () => {
    const response = await worker.fetch(
      await signedOpRequest("list-objects", { prefix: "exports/" }),
      env(),
      { waitUntil: () => undefined } as never
    );
    expect(response.status).toBe(400);
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

  test("streams a validated pending upload, preserves a Markdown BOM and leaves the pending object for Convex to delete", async () => {
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

  test("size-bound import capabilities preserve 64 MiB parts and 24-hour expiry while rejecting tampering and post-freeze writes", async () => {
    const env_ = env();
    const bucket = env_.BUCKET as unknown as FakeBucket;
    const key = "users/u1/imports/proof/source.zip";
    const multipart = bucket.createMultipartUpload(key);
    const bytes = new Uint8Array(64 * 1024 * 1024);
    const size = bytes.byteLength;
    const expiresAt = String(Math.floor(Date.now() / 1000) + 86_400);
    const url = new URL(
      `https://files.teakvault.com/__uploads/v1/${multipart.uploadId}/1`
    );
    url.searchParams.set("key", key);
    url.searchParams.set("exp", expiresAt);
    url.searchParams.set("sz", String(size));
    url.searchParams.set(
      "sig",
      await hmacSha256Hex(
        SECRET,
        buildMultipartPartSigningPayload({
          key,
          uploadId: multipart.uploadId,
          partNumber: 1,
          expiresAt,
          size,
        })
      )
    );
    const put = (target: URL, bodySize: number) =>
      worker.fetch(
        new Request(target, {
          method: "PUT",
          body: new Blob([bytes.subarray(0, bodySize)]),
          headers: { "content-length": String(bodySize) },
        }),
        env_,
        { waitUntil: () => undefined } as never
      );
    const tampered = new URL(url);
    tampered.searchParams.set("sz", String(size - 1));
    expect((await put(tampered, 1)).status).toBe(403);
    expect((await put(url, 1)).status).toBe(413);
    expect((await put(url, size)).status).toBe(204);
    const frozen = await worker.fetch(
      await signedOpRequest("freeze-object", { key }),
      env_,
      { waitUntil: () => undefined } as never
    );
    expect(frozen.status).toBe(200);
    expect((await put(url, size)).status).toBe(409);
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

  test("refuses a multipart part URL with a malformed upload id instead of crashing", async () => {
    const reported: unknown[] = [];
    const url = new URL(
      "https://files.teakvault.com/__uploads/v1/%E0%A4%A/1?key=users/u1/x&exp=1&sig=00"
    );
    url.searchParams.set("exp", String(Math.floor(Date.now() / 1000) + 600));
    const response = await worker.fetch(
      new Request(url, {
        body: "part",
        headers: { "content-length": "4" },
        method: "PUT",
      }),
      env(),
      { waitUntil: (promise: unknown) => reported.push(promise) } as never
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "AUTH_INVALID", retryable: false },
      ok: false,
    });
    expect(reported).toEqual([]);
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

  test("serves a page archive sandboxed, with no scripts and nothing loaded", async () => {
    const env_ = env();
    seed(env_);
    const archiveKey = "users/u1/cards/c1/page-archive/r1-archive.html";
    (env_.BUCKET as unknown as FakeBucket).objects.set(archiveKey, {
      bytes: new TextEncoder().encode("<p>Saved</p>"),
      httpMetadata: { contentType: "text/html; charset=utf-8" },
    });
    const archive = await worker.fetch(
      new Request(await signedUrl(`/${archiveKey}`)),
      env_,
      { waitUntil: () => undefined } as never
    );
    expect(archive.status).toBe(200);
    expect(archive.headers.get("content-security-policy")).toBe(
      "sandbox allow-popups allow-popups-to-escape-sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline' data:; font-src data:"
    );
    // Its links may open new tabs, but it never runs scripts or reads the
    // files origin.
    expect(archive.headers.get("content-security-policy")).not.toMatch(
      /allow-scripts|allow-same-origin/u
    );
    expect(archive.headers.get("cross-origin-resource-policy")).toBe(
      "cross-origin"
    );
    expect(archive.headers.get("x-content-type-options")).toBe("nosniff");

    const image = await worker.fetch(
      new Request(await signedUrl("/users/u1/cards/f/x.png")),
      env_,
      { waitUntil: () => undefined } as never
    );
    expect(image.headers.get("content-security-policy")).toBeNull();
    expect(image.headers.get("cross-origin-resource-policy")).toBeNull();
  });

  test.each([
    ["image/svg+xml", {}],
    ["text/html; charset=utf-8", {}],
    ["application/octet-stream", { ct: "application/xhtml+xml" }],
    ["text/xml", { ct: "text/plain", cd: "inline" }],
  ] as const)(
    "never runs scripts in a stored %s opened from its signed link",
    async (storedType, params) => {
      // An article image or preview fetched from a page keeps the type its
      // server sent, and Convex signs those keys without a type of its own.
      const env_ = env();
      const key = "users/u1/cards/c1/article/r1/0.svg";
      (env_.BUCKET as unknown as FakeBucket).objects.set(key, {
        bytes: new TextEncoder().encode(
          '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
        ),
        httpMetadata: { contentType: storedType },
      });
      const served = await worker.fetch(
        new Request(await signedUrl(`/${key}`, params)),
        env_,
        { waitUntil: () => undefined } as never
      );
      expect(served.status).toBe(200);
      const scriptable = /html|xml/u.test(
        served.headers.get("content-type") ?? ""
      );
      const policy = served.headers.get("content-security-policy");
      if (scriptable) {
        expect(policy).toStartWith("sandbox;");
        expect(policy).toContain("default-src 'none'");
      } else {
        expect(policy).toBeNull();
      }
    }
  );

  test("sandboxes scriptable files on ranged reads too", async () => {
    const env_ = env();
    const key = "users/u1/cards/c1/files/page.html";
    (env_.BUCKET as unknown as FakeBucket).objects.set(key, {
      bytes: new TextEncoder().encode("<script>alert(1)</script>"),
      httpMetadata: { contentType: "text/html" },
    });
    const served = await worker.fetch(
      new Request(await signedUrl(`/${key}`), {
        headers: { range: "bytes=0-7" },
      }),
      env_,
      { waitUntil: () => undefined } as never
    );
    expect(served.status).toBe(206);
    expect(served.headers.get("content-security-policy")).toStartWith(
      "sandbox;"
    );
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

  describe("edge cache", () => {
    const runtime = globalThis as unknown as { caches: { default: Cache } };
    const original = runtime.caches;
    let stored: Map<string, { bytes: ArrayBuffer; headers: Headers }>;

    beforeEach(() => {
      stored = new Map();
      runtime.caches = {
        default: {
          delete: (key: Request) => Promise.resolve(stored.delete(key.url)),
          match: (key: Request) => {
            const hit = stored.get(key.url);
            return Promise.resolve(
              hit
                ? new Response(hit.bytes.slice(0), { headers: hit.headers })
                : undefined
            );
          },
          put: async (key: Request, response: Response) => {
            stored.set(key.url, {
              bytes: await response.arrayBuffer(),
              headers: new Headers(response.headers),
            });
          },
        } as unknown as Cache,
      };
    });

    afterEach(() => {
      runtime.caches = original;
    });

    const download = async (env_: Env, headers: HeadersInit = {}) => {
      const pending: Promise<unknown>[] = [];
      const response = await worker.fetch(
        new Request(await signedUrl("/users/u1/cards/f/x.png"), { headers }),
        env_,
        {
          waitUntil: (promise: Promise<unknown>) => pending.push(promise),
        } as never
      );
      await Promise.all(pending);
      return response;
    };

    const countGets = (env_: Env) => {
      const bucket = env_.BUCKET as unknown as FakeBucket;
      const get = bucket.get.bind(bucket);
      const calls = { count: 0 };
      bucket.get = (...args: Parameters<FakeBucket["get"]>) => {
        calls.count += 1;
        return get(...args);
      };
      return calls;
    };

    test("serves a repeat download from the edge without reading the body from R2", async () => {
      const env_ = env();
      seed(env_);
      const gets = countGets(env_);
      await (await download(env_)).arrayBuffer();

      const again = await download(env_);
      expect(again.status).toBe(200);
      expect(new Uint8Array(await again.arrayBuffer())).toEqual(
        makePng(32, 32)
      );
      expect(gets.count).toBe(1);
    });

    test("a deleted file is gone even while a signed link to it is valid", async () => {
      const env_ = env();
      seed(env_);
      await (await download(env_)).arrayBuffer();
      expect(stored.size).toBe(1);

      (env_.BUCKET as unknown as FakeBucket).objects.delete(
        "users/u1/cards/f/x.png"
      );

      const etag = fakeHttpEtag(makePng(32, 32));
      expect((await download(env_)).status).toBe(404);
      expect((await download(env_, { "if-none-match": etag })).status).toBe(
        404
      );
      expect(stored.size).toBe(0);
    });

    test("a file replaced under the same key serves its new bytes", async () => {
      const env_ = env();
      seed(env_);
      await (await download(env_)).arrayBuffer();

      const replaced = makePng(16, 16);
      (env_.BUCKET as unknown as FakeBucket).objects.set(
        "users/u1/cards/f/x.png",
        { bytes: replaced, httpMetadata: { contentType: "image/png" } }
      );

      const response = await download(env_);
      expect(response.status).toBe(200);
      expect(response.headers.get("etag")).toBe(fakeHttpEtag(replaced));
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(replaced);
    });

    test("an object too large for the edge cache streams straight through", async () => {
      // Export archives reach 5 GB; the Cache API keeps at most 512 MB, so a
      // second copy of the stream would only pile up unread.
      const env_ = env();
      seed(env_);
      const bucket = env_.BUCKET as unknown as FakeBucket;
      const get = bucket.get.bind(bucket);
      bucket.get = (...args: Parameters<FakeBucket["get"]>) => {
        const object = get(...args);
        return object ? { ...object, size: 600 * 1024 * 1024 } : object;
      };
      const response = await download(env_);
      expect(response.status).toBe(200);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(
        makePng(32, 32)
      );
      expect(stored.size).toBe(0);
    });
  });

  describe("transient R2 read failures", () => {
    const R2_INTERNAL_ERROR =
      "get: We encountered an internal error. Please try again. (10001)";

    const failingGets = (env_: Env, message: string, failures: number) => {
      const bucket = env_.BUCKET as unknown as FakeBucket;
      const get = bucket.get.bind(bucket);
      const calls = { count: 0 };
      bucket.get = (...args: Parameters<FakeBucket["get"]>) => {
        calls.count += 1;
        if (calls.count <= failures) {
          throw new Error(message);
        }
        return get(...args);
      };
      return calls;
    };

    const download = async (env_: Env) =>
      worker.fetch(
        new Request(await signedUrl("/users/u1/cards/f/x.png")),
        env_,
        { waitUntil: () => undefined } as never
      );

    test("serves the object when R2 recovers from an internal error", async () => {
      const env_ = env();
      seed(env_);
      const calls = failingGets(env_, R2_INTERNAL_ERROR, 2);
      const response = await download(env_);
      expect(response.status).toBe(200);
      expect(new Uint8Array(await response.arrayBuffer()).length).toBe(
        makePng(32, 32).length
      );
      expect(calls.count).toBe(3);
    });

    test("fails after R2 keeps returning internal errors", async () => {
      const env_ = env();
      seed(env_);
      const calls = failingGets(env_, R2_INTERNAL_ERROR, 10);
      await expect(download(env_)).rejects.toThrow(R2_INTERNAL_ERROR);
      expect(calls.count).toBe(3);
    });

    test("does not retry errors R2 does not mark as transient", async () => {
      const env_ = env();
      seed(env_);
      const calls = failingGets(env_, "get: Object key too long (10020)", 1);
      await expect(download(env_)).rejects.toThrow("(10020)");
      expect(calls.count).toBe(1);
    });
  });
});

describe("API paths on the marketing host", () => {
  const originalFetch = globalThis.fetch;
  const apiEnv = (): Env => ({
    ...env(),
    API_PUBLIC_HOST: "teakvault.com",
    API_UPSTREAM_ORIGIN: "https://upstream.example.convex.site",
    OBJECT_GATES: undefined,
  });
  const fetchedUrls: string[] = [];
  const stubFetch = () => {
    fetchedUrls.length = 0;
    globalThis.fetch = ((input: RequestInfo | URL) => {
      fetchedUrls.push(input instanceof Request ? input.url : String(input));
      return Promise.resolve(new Response("origin", { status: 200 }));
    }) as typeof fetch;
  };

  test("go to Convex", async () => {
    stubFetch();
    try {
      const response = await worker.fetch(
        new Request("https://teakvault.com/api/v1/me"),
        apiEnv(),
        {} as ExecutionContext
      );
      expect(response.status).toBe(200);
      expect(fetchedUrls).toEqual([
        "https://upstream.example.convex.site/v1/me",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("Convex does not serve fall through to the site's origin", async () => {
    stubFetch();
    try {
      const response = await worker.fetch(
        new Request("https://teakvault.com/apis"),
        apiEnv(),
        {} as ExecutionContext
      );
      expect(await response.text()).toBe("origin");
      expect(fetchedUrls).toEqual(["https://teakvault.com/apis"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
