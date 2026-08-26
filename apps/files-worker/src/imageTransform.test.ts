import { describe, expect, test } from "bun:test";
import {
  buildImageSigningPayload,
  buildImageSourceSigningPayload,
} from "@teak/files-protocol";
import { handleImageRequest, handleImageSourceRequest } from "./imageTransform";
import type { Env } from "./index";
import { hmacSha256Hex } from "./lib";
import { FakeBucket, makePng } from "./testsupport";

const SECRET = "image-test-secret";
const NOW = 1_800_000_000;
const KEY = "users/u1/cards/c1/file/design.png";
const SVG_KEY = "users/u1/cards/c1/file/design.svg";
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><rect width="120" height="80" fill="#ff0000"/></svg>`;

const makeEnv = (contentType = "image/png"): Env => {
  const bucket = new FakeBucket();
  bucket.objects.set(KEY, {
    bytes: makePng(32, 24),
    httpMetadata: { contentType },
  });
  return {
    BUCKET: bucket as unknown as R2Bucket,
    FILES_SIGNING_SECRET: SECRET,
  };
};

const makeSvgEnv = (): Env => {
  const bucket = new FakeBucket();
  bucket.objects.set(SVG_KEY, {
    bytes: new TextEncoder().encode(SVG),
    httpMetadata: { contentType: "text/xml" },
  });
  return {
    BUCKET: bucket as unknown as R2Bucket,
    FILES_SIGNING_SECRET: SECRET,
  };
};

const signedImageRequest = async (
  rendition: "tiny" | "compact" | "detail" | "grid",
  accept = "image/avif,image/webp",
  key = KEY,
  expiresAt = String(NOW + 3600)
): Promise<Request> => {
  const signature = await hmacSha256Hex(
    SECRET,
    buildImageSigningPayload({ expiresAt, key, rendition })
  );
  return new Request(
    `https://files.teakvault.com/__images/v1/${rendition}/${encodeURIComponent(key)}?exp=${expiresAt}&sig=${signature}`,
    { headers: { accept } }
  );
};

describe("Cloudflare image transformations", () => {
  test("binds access to a fixed rendition and sends a private source request", async () => {
    const request = await signedImageRequest("grid");
    let capturedUrl = "";
    let capturedInit: (RequestInit & { cf?: Record<string, unknown> }) | null =
      null;
    const response = await handleImageRequest(
      request,
      makeEnv(),
      (input, init) => {
        capturedUrl = String(input);
        capturedInit = init ?? null;
        return Promise.resolve(
          new Response(makePng(16, 12), {
            headers: { "content-type": "image/avif" },
          })
        );
      },
      NOW
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/avif");
    expect(capturedUrl).toBe(
      `https://files.teakvault.com/__image-source/v1/${encodeURIComponent(KEY)}`
    );
    expect(new Headers(capturedInit?.headers).get("authorization")).toMatch(
      /^Teak [0-9]+:[a-f0-9]{64}$/u
    );
    expect(capturedInit?.cf).toEqual({
      image: {
        anim: true,
        fit: "scale-down",
        format: "avif",
        height: 512,
        metadata: "none",
        "origin-auth": "share-publicly",
        quality: 80,
        sharpen: 1,
        width: 512,
      },
    });
  });

  test("rejects a valid signature reused for another rendition", async () => {
    const grid = await signedImageRequest("grid");
    const url = new URL(grid.url);
    url.pathname = url.pathname.replace("/grid/", "/detail/");
    const response = await handleImageRequest(
      new Request(url),
      makeEnv(),
      async () => new Response(),
      NOW
    );
    expect(response.status).toBe(403);
  });

  test("does not expose the source route without Image Resizing provenance", async () => {
    const expiresAt = String(NOW + 120);
    const signature = await hmacSha256Hex(
      SECRET,
      buildImageSourceSigningPayload({ expiresAt, key: KEY })
    );
    const url = `https://files.teakvault.com/__image-source/v1/${encodeURIComponent(KEY)}`;
    const authorization = `Teak ${expiresAt}:${signature}`;

    const direct = await handleImageSourceRequest(
      new Request(url, { headers: { authorization } }),
      makeEnv(),
      undefined,
      NOW
    );
    expect(direct.status).toBe(403);

    const internal = await handleImageSourceRequest(
      new Request(url, {
        headers: { authorization, via: "image-resizing" },
      }),
      makeEnv(),
      undefined,
      NOW
    );
    expect(internal.status).toBe(200);
    expect(internal.headers.get("content-type")).toBe("image/png");
  });

  test("falls back only for browser-renderable originals", async () => {
    const request = await signedImageRequest("detail", "image/webp");
    const fallback = await handleImageRequest(
      request,
      makeEnv(),
      async () => new Response(null, { status: 502 }),
      NOW
    );
    expect(fallback.status).toBe(200);
    expect(fallback.headers.get("content-type")).toBe("image/png");

    const unavailable = await handleImageRequest(
      request,
      makeEnv("image/heic"),
      async () => new Response(null, { status: 415 }),
      NOW
    );
    expect(unavailable.status).toBe(415);
  });

  test("rasterizes signed SVG renditions for GET and HEAD", async () => {
    const request = await signedImageRequest("grid", "image/avif", SVG_KEY);
    const getResponse = await handleImageRequest(
      request,
      makeSvgEnv(),
      undefined,
      NOW
    );
    const png = new Uint8Array(await getResponse.arrayBuffer());

    expect(getResponse.status).toBe(200);
    expect(getResponse.headers.get("content-type")).toBe("image/png");
    expect(getResponse.headers.get("content-length")).toBe(String(png.length));
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(
      new DataView(png.buffer, png.byteOffset, png.byteLength).getUint32(16)
    ).toBe(120);
    expect(
      new DataView(png.buffer, png.byteOffset, png.byteLength).getUint32(20)
    ).toBe(80);

    const headResponse = await handleImageRequest(
      new Request(request.url, { method: "HEAD" }),
      makeSvgEnv(),
      undefined,
      NOW
    );
    expect(headResponse.status).toBe(200);
    expect(headResponse.headers.get("content-type")).toBe("image/png");
    expect(headResponse.headers.get("content-length")).toBe(String(png.length));
    expect(await headResponse.arrayBuffer()).toHaveLength(0);
  });

  test("rejects expired, missing, and non-image rendition requests", async () => {
    const expired = await signedImageRequest(
      "grid",
      "image/webp",
      KEY,
      String(NOW - 1)
    );
    expect(
      (await handleImageRequest(expired, makeEnv(), undefined, NOW)).status
    ).toBe(410);

    const missing = await signedImageRequest(
      "grid",
      "image/webp",
      "users/u1/cards/c1/file/missing.png"
    );
    expect(
      (await handleImageRequest(missing, makeEnv(), undefined, NOW)).status
    ).toBe(404);

    const nonImage = await signedImageRequest("grid");
    expect(
      (
        await handleImageRequest(
          nonImage,
          makeEnv("application/pdf"),
          undefined,
          NOW
        )
      ).status
    ).toBe(415);
  });

  test("rejects oversized SVG sources before rasterization", async () => {
    const bucket = new FakeBucket();
    bucket.objects.set(SVG_KEY, {
      bytes: new Uint8Array(10 * 1024 * 1024 + 1),
      httpMetadata: { contentType: "image/svg+xml" },
    });
    const request = await signedImageRequest("detail", "image/webp", SVG_KEY);
    const response = await handleImageRequest(
      request,
      {
        BUCKET: bucket as unknown as R2Bucket,
        FILES_SIGNING_SECRET: SECRET,
      },
      undefined,
      NOW
    );

    expect(response.status).toBe(413);
  });

  test("serves the tiny and compact renditions with server-controlled sizes", async () => {
    for (const [rendition, edge] of [
      ["tiny", 48],
      ["compact", 256],
    ] as const) {
      const request = await signedImageRequest(rendition);
      let capturedInit:
        | (RequestInit & { cf?: Record<string, unknown> })
        | null = null;
      const response = await handleImageRequest(
        request,
        makeEnv(),
        (_input, init) => {
          capturedInit = init ?? null;
          return Promise.resolve(
            new Response(makePng(16, 12), {
              headers: { "content-type": "image/webp" },
            })
          );
        },
        NOW
      );
      expect(response.status).toBe(200);
      expect(capturedInit?.cf).toEqual({
        image: {
          anim: true,
          fit: "scale-down",
          format: "avif",
          height: edge,
          metadata: "none",
          "origin-auth": "share-publicly",
          quality: rendition === "tiny" ? 60 : 80,
          sharpen: 1,
          width: edge,
        },
      });
    }
  });

  test("transforms eligible sources directly through the Images binding", async () => {
    const transforms: Record<string, unknown>[] = [];
    const outputs: Record<string, unknown>[] = [];
    const env = {
      ...makeEnv(),
      IMAGES: {
        input: (stream: ReadableStream<Uint8Array>) => ({
          transform: (options: Record<string, unknown>) => {
            transforms.push(options);
            return {
              output: async (outputOptions: Record<string, unknown>) => {
                outputs.push(outputOptions);
                await stream.cancel();
                return {
                  contentType: () => "image/webp",
                  response: () =>
                    new Response(makePng(4, 4), {
                      headers: { "content-type": "image/webp" },
                    }),
                };
              },
            };
          },
        }),
      },
    } as unknown as Env;

    let fetchCalled = false;
    const response = await handleImageRequest(
      await signedImageRequest("grid"),
      env,
      () => {
        fetchCalled = true;
        return Promise.resolve(new Response(null, { status: 500 }));
      },
      NOW
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("etag")).toMatch(/-grid"$/u);
    expect(transforms).toEqual([
      { fit: "scale-down", height: 512, sharpen: 1, width: 512 },
    ]);
    expect(outputs).toEqual([
      { anim: true, format: "image/avif", quality: 80 },
    ]);
    // The internal signed source round-trip never happens on this path.
    expect(fetchCalled).toBe(false);
  });

  test("stores binding renditions with public edge-cache headers", async () => {
    const env = {
      ...makeEnv(),
      IMAGES: {
        input: (stream: ReadableStream<Uint8Array>) => ({
          transform: () => ({
            output: async () => {
              await stream.cancel();
              return {
                contentType: () => "image/avif",
                response: () =>
                  new Response(makePng(4, 4), {
                    headers: { "content-type": "image/avif" },
                  }),
              };
            },
          }),
        }),
      },
    } as unknown as Env;
    let cachedResponse: Response | null = null;
    const pending: Promise<unknown>[] = [];
    const cache = {
      match: () => Promise.resolve(undefined),
      put: (_key: Request, response: Response) => {
        cachedResponse = response;
        return Promise.resolve();
      },
    } as unknown as Cache;
    const ctx = {
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    } as unknown as ExecutionContext;

    const response = await handleImageRequest(
      await signedImageRequest("grid", "image/avif"),
      env,
      undefined,
      NOW,
      ctx,
      cache
    );
    await Promise.all(pending);

    expect(response.headers.get("cache-control")).toContain("private");
    expect(cachedResponse).not.toBeNull();
    expect((cachedResponse as Response).headers.get("cache-control")).toContain(
      "public"
    );
  });

  test("falls back to URL transformations when the binding fails", async () => {
    const env = {
      ...makeEnv(),
      IMAGES: {
        input: () => ({
          transform: () => ({
            output: () => Promise.reject(new Error("binding exploded")),
          }),
        }),
      },
    } as unknown as Env;

    const response = await handleImageRequest(
      await signedImageRequest("grid", "image/webp"),
      env,
      () =>
        Promise.resolve(
          new Response(makePng(16, 12), {
            headers: { "content-type": "image/webp" },
          })
        ),
      NOW
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
  });

  test("never serves raw HEIC when transformations fail", async () => {
    const request = await signedImageRequest("detail", "image/webp");
    const unavailable = await handleImageRequest(
      request,
      makeEnv("image/heic"),
      async () => new Response(null, { status: 503 }),
      NOW
    );
    expect(unavailable.status).toBe(415);
    expect(unavailable.body).toBeNull();
  });

  test("requests JPEG for HEIC when Accept has no modern image format", async () => {
    const request = await signedImageRequest("detail", "*/*");
    let capturedInit:
      | (RequestInit & { cf?: { image?: Record<string, unknown> } })
      | undefined;
    const response = await handleImageRequest(
      request,
      makeEnv("image/heic"),
      (_input, init) => {
        capturedInit = init;
        return Promise.resolve(
          new Response(makePng(16, 12), {
            headers: { "content-type": "image/jpeg" },
          })
        );
      },
      NOW
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(capturedInit?.cf?.image?.format).toBe("jpeg");
  });

  test("rejects a successful HEIC transform that is still not browser-safe", async () => {
    const response = await handleImageRequest(
      await signedImageRequest("detail", "*/*"),
      makeEnv("image/heic; charset=binary"),
      () =>
        Promise.resolve(
          new Response(new Uint8Array([1, 2, 3]), {
            headers: { "content-type": "image/heic" },
          })
        ),
      NOW
    );

    expect(response.status).toBe(415);
    expect(response.body).toBeNull();
  });
});
