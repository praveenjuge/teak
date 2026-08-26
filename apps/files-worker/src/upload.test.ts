import { describe, expect, test } from "bun:test";
import {
  buildFilesOpSigningPayload,
  buildUploadSigningPayload,
  FILES_PROTOCOL_VERSION,
} from "@teak/files-protocol";
import worker, { type Env } from "./index";
import { hmacSha256Hex, sha256Hex } from "./lib";
import { FakeBucket } from "./testsupport";

const SECRET = "test-secret";

const env = (): Env =>
  ({
    BUCKET: new FakeBucket() as unknown as R2Bucket,
    FILES_SIGNING_SECRET: SECRET,
  }) as Env;

interface UploadUrlOptions {
  boundSize?: number | null;
  contentType?: string;
  expSecondsFromNow?: number;
  key?: string;
}

const signedUploadRequest = async (
  body: Uint8Array | null,
  {
    boundSize = null,
    contentType = "text/plain",
    expSecondsFromNow = 600,
    key = "users/u1/cards/file/abc-test.txt",
  }: UploadUrlOptions = {},
  overrides: Record<string, string> = {}
): Promise<Request> => {
  const url = new URL(`https://files.teakvault.com/__upload/v1/${key}`);
  const exp = String(Math.floor(Date.now() / 1000) + expSecondsFromNow);
  const sig = await hmacSha256Hex(
    SECRET,
    buildUploadSigningPayload({
      contentType,
      expiresAt: exp,
      key: decodeURIComponent(key),
      size: boundSize,
    })
  );
  url.searchParams.set("exp", exp);
  url.searchParams.set("sig", sig);
  if (contentType) {
    url.searchParams.set("ct", contentType);
  }
  if (boundSize !== null) {
    url.searchParams.set("sz", String(boundSize));
  }
  for (const [name, value] of Object.entries(overrides)) {
    if (value === "") {
      url.searchParams.delete(name);
    } else {
      url.searchParams.set(name, value);
    }
  }
  return new Request(url.toString(), {
    body: body === null ? undefined : body,
    method: "PUT",
    headers:
      body === null
        ? { "x-teak-request-id": crypto.randomUUID() }
        : {
            "content-length": String(body.byteLength),
            "content-type": `${contentType}; charset=utf-8`,
            "x-teak-request-id": crypto.randomUUID(),
          },
  });
};

const signedOpRequest = async (
  op: string,
  params: Record<string, unknown>
): Promise<Request> => {
  const body = JSON.stringify({ op, params, version: FILES_PROTOCOL_VERSION });
  const requestId = crypto.randomUUID();
  const expiresAt = String(Math.floor(Date.now() / 1000) + 600);
  const bodySha256 = await sha256Hex(body);
  return new Request("https://files.teakvault.com/__ops/v1", {
    body,
    method: "POST",
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

describe("signed single-file uploads", () => {
  test("accepts a valid upload and stores the object with signed metadata", async () => {
    const bucket = new FakeBucket();
    const envWithBucket = {
      BUCKET: bucket,
      FILES_SIGNING_SECRET: SECRET,
    } as Env;
    const bytes = new TextEncoder().encode("hello teak");
    const response = await worker.fetch(
      await signedUploadRequest(bytes, { boundSize: bytes.byteLength }),
      envWithBucket,
      { waitUntil: () => undefined } as never
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      data: { etag: string; key: string; size: number };
      ok: boolean;
    };
    expect(payload.ok).toBe(true);
    expect(payload.data.key).toBe("users/u1/cards/file/abc-test.txt");
    expect(payload.data.size).toBe(bytes.byteLength);
    expect(payload.data.etag).toBeTruthy();
    expect(response.headers.get("etag")).toBe(payload.data.etag);
    const stored = bucket.objects.get("users/u1/cards/file/abc-test.txt");
    expect(stored?.httpMetadata?.contentType).toBe("text/plain");
    expect(new TextDecoder().decode(stored?.bytes ?? new Uint8Array())).toBe(
      "hello teak"
    );
  });

  test("accepts an unbound content type and stores the request header", async () => {
    const bucket = new FakeBucket();
    const envWithBucket = {
      BUCKET: bucket,
      FILES_SIGNING_SECRET: SECRET,
    } as Env;
    // Signature is minted with an empty content type (no ct param); the
    // request's own validated Content-Type is stored verbatim.
    const key = "users/u1/cards/thumbnail/frame";
    const exp = String(Math.floor(Date.now() / 1000) + 600);
    const sig = await hmacSha256Hex(
      SECRET,
      buildUploadSigningPayload({ contentType: "", expiresAt: exp, key })
    );
    const url = new URL(`https://files.teakvault.com/__upload/v1/${key}`);
    url.searchParams.set("exp", exp);
    url.searchParams.set("sig", sig);
    const body = new Uint8Array([1, 2, 3, 4]);
    const response = await worker.fetch(
      new Request(url.toString(), {
        body,
        method: "PUT",
        headers: {
          "content-length": String(body.byteLength),
          "content-type": "image/webp",
          "x-teak-request-id": crypto.randomUUID(),
        },
      }),
      envWithBucket,
      { waitUntil: () => undefined } as never
    );
    expect(response.status).toBe(200);
    const stored = bucket.objects.get(key);
    expect(stored?.httpMetadata?.contentType).toBe("image/webp");
  });

  test("rejects expired signatures", async () => {
    const response = await worker.fetch(
      await signedUploadRequest(new TextEncoder().encode("x"), {
        expSecondsFromNow: -10,
      }),
      env(),
      { waitUntil: () => undefined } as never
    );
    expect(response.status).toBe(410);
  });

  test("rejects signatures too far in the future", async () => {
    const response = await worker.fetch(
      await signedUploadRequest(new TextEncoder().encode("x"), {
        expSecondsFromNow: 60 * 60 * 24 * 30,
      }),
      env(),
      { waitUntil: () => undefined } as never
    );
    expect(response.status).toBe(403);
  });

  test("rejects tampered signatures", async () => {
    const response = await worker.fetch(
      await signedUploadRequest(
        new TextEncoder().encode("x"),
        {},
        { sig: "0".repeat(64) }
      ),
      env(),
      { waitUntil: () => undefined } as never
    );
    expect(response.status).toBe(403);
  });

  test("rejects content type mismatch between signature and request", async () => {
    // Signature is minted for text/plain but the URL ct param says image/png.
    const response = await worker.fetch(
      await signedUploadRequest(
        new TextEncoder().encode("x"),
        {},
        { ct: "image/png" }
      ),
      env(),
      { waitUntil: () => undefined } as never
    );
    expect(response.status).toBe(403);
  });

  test("binds the signature to the exact object key", async () => {
    const signed = await signedUploadRequest(new TextEncoder().encode("x"));
    const url = new URL(signed.url);
    // Same signature, different object key.
    url.pathname = "/__upload/v1/users/u1/cards/file/other.txt";
    const response = await worker.fetch(
      new Request(url.toString(), {
        body: new TextEncoder().encode("x"),
        method: "PUT",
        headers: {
          "content-length": "1",
          "content-type": "text/plain",
        },
      }),
      env(),
      { waitUntil: () => undefined } as never
    );
    expect(response.status).toBe(403);
  });

  test("rejects path traversal keys", async () => {
    for (const key of [
      "users/../secrets/x.txt",
      "users/u1//double/x.txt",
      "not-users/u1/x.txt",
    ]) {
      const response = await worker.fetch(
        await signedUploadRequest(new TextEncoder().encode("x"), { key }),
        env(),
        { waitUntil: () => undefined } as never
      );
      expect(response.status).toBe(400);
    }
  });

  test("requires Content-Length", async () => {
    const request = await signedUploadRequest(null);
    const response = await worker.fetch(request, env(), {
      waitUntil: () => undefined,
    } as never);
    expect(response.status).toBe(411);
  });

  test("accepts uploads without a bound size", async () => {
    const bytes = new Uint8Array(2048);
    const response = await worker.fetch(
      await signedUploadRequest(bytes),
      env(),
      { waitUntil: () => undefined } as never
    );
    // No size binding; content length is small so this passes auth but the
    // cap check only trips on genuinely large bodies. Verify acceptance path.
    expect(response.status).toBe(200);
  });

  test("enforces a bound size mismatch", async () => {
    const bytes = new TextEncoder().encode("hello");
    const request = await signedUploadRequest(bytes, { boundSize: 999 });
    const response = await worker.fetch(request, env(), {
      waitUntil: () => undefined,
    } as never);
    expect(response.status).toBe(409);
  });

  test("answers OPTIONS preflight for the upload path", async () => {
    const response = await worker.fetch(
      new Request("https://files.teakvault.com/__upload/v1/users/u1/x.txt", {
        method: "OPTIONS",
      }),
      env(),
      { waitUntil: () => undefined } as never
    );
    expect(response.status).toBe(204);
  });
});

describe("additive files ops", () => {
  test("delete-objects removes batches and tolerates missing keys", async () => {
    const bucket = new FakeBucket();
    bucket.objects.set("users/u1/a.txt", {
      bytes: new TextEncoder().encode("a"),
    });
    const response = await worker.fetch(
      await signedOpRequest("delete-objects", {
        keys: ["users/u1/a.txt", "users/u1/missing.bin"],
      }),
      { BUCKET: bucket, FILES_SIGNING_SECRET: SECRET } as Env,
      { waitUntil: () => undefined } as never
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      data: { deleted: number };
      ok: boolean;
    };
    expect(payload.ok).toBe(true);
    expect(payload.data.deleted).toBe(2);
    expect(bucket.objects.has("users/u1/a.txt")).toBe(false);
  });

  test("delete-objects rejects oversized and malformed batches", async () => {
    const response = await worker.fetch(
      await signedOpRequest("delete-objects", {
        keys: Array.from({ length: 101 }, (_, index) => `users/u1/${index}`),
      }),
      env(),
      { waitUntil: () => undefined } as never
    );
    expect(response.status).toBe(400);

    const traversal = await worker.fetch(
      await signedOpRequest("delete-objects", { keys: ["../escape"] }),
      env(),
      { waitUntil: () => undefined } as never
    );
    expect(traversal.status).toBe(400);
  });

  test("head-object reports existence, size, and content type", async () => {
    const bucket = new FakeBucket();
    bucket.objects.set("users/u1/img.png", {
      bytes: new TextEncoder().encode("png-bytes"),
      httpMetadata: { contentType: "image/png" },
    });
    const present = await worker.fetch(
      await signedOpRequest("head-object", { key: "users/u1/img.png" }),
      { BUCKET: bucket, FILES_SIGNING_SECRET: SECRET } as Env,
      { waitUntil: () => undefined } as never
    );
    const payload = (await present.json()) as {
      data: Record<string, unknown>;
    };
    expect(payload.data.exists).toBe(true);
    expect(payload.data.size).toBe(9);
    expect(payload.data.contentType).toBe("image/png");

    const missing = await worker.fetch(
      await signedOpRequest("head-object", { key: "users/u1/nope.png" }),
      { BUCKET: bucket, FILES_SIGNING_SECRET: SECRET } as Env,
      { waitUntil: () => undefined } as never
    );
    const missingPayload = (await missing.json()) as {
      data: Record<string, unknown>;
    };
    expect(missingPayload.data.exists).toBe(false);
  });

  test("analyze-image-content behaves like analyze-image", async () => {
    const response = await worker.fetch(
      await signedOpRequest("analyze-image-content", {
        sourceKey: "users/u1/missing.png",
      }),
      env(),
      { waitUntil: () => undefined } as never
    );
    expect(response.status).toBe(404);
  });

  test("generate-image-metadata validates AI output with bounded retries", async () => {
    let calls = 0;
    let capturedImageUrl: unknown;
    const aiEnv = {
      AI: {
        run: (_model: string, args: Record<string, unknown>) => {
          calls += 1;
          const messages = args.messages as Array<{
            content?: Array<{ image_url?: unknown; type?: string }>;
          }>;
          capturedImageUrl = messages
            .flatMap((message) => message.content ?? [])
            .find((part) => part.type === "image_url")?.image_url;
          // First call returns invalid JSON, second valid output.
          if (calls === 1) {
            return {
              choices: [{ message: { content: "not json at all" } }],
            };
          }
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    summary: "A red square.",
                    tags: ["red", "square"],
                  }),
                },
              },
            ],
          };
        },
      },
      BUCKET: new FakeBucket(),
      FILES_SIGNING_SECRET: SECRET,
    } as unknown as Env;

    // Seed a tiny PNG source so the detail rendition transform can be faked.
    const bucket = aiEnv.BUCKET as unknown as FakeBucket;
    bucket.objects.set("users/u1/pic.png", {
      bytes: new Uint8Array([1]),
      httpMetadata: { contentType: "image/png" },
    });

    let capturedTransform: Record<string, unknown> | undefined;
    const fakeFetch = ((
      _input: RequestInfo | URL,
      init?: RequestInit & { cf?: { image?: Record<string, unknown> } }
    ): Promise<Response> => {
      capturedTransform = init?.cf?.image;
      return Promise.resolve(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        })
      );
    }) as typeof fetch;

    const { generateImageMetadataForOp } = await import("./imageMetadata");
    const result = await generateImageMetadataForOp(
      aiEnv,
      { origin: "https://files.teakvault.com", sourceKey: "users/u1/pic.png" },
      Math.floor(Date.now() / 1000),
      fakeFetch
    );
    expect(result.tags).toEqual(["red", "square"]);
    expect(result.summary).toBe("A red square.");
    expect(calls).toBe(2);
    expect(capturedImageUrl).toEqual({
      url: "data:image/jpeg;base64,AQID",
    });
    expect(capturedTransform).toEqual({
      anim: true,
      fit: "scale-down",
      height: 1600,
      metadata: "none",
      quality: 85,
      sharpen: 1,
      width: 1600,
      "origin-auth": "share-publicly",
    });
  });
});
