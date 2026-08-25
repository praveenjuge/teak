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

const signedImageRequest = async (
  rendition: "detail" | "grid",
  accept = "image/avif,image/webp"
): Promise<Request> => {
  const expiresAt = String(NOW + 3600);
  const signature = await hmacSha256Hex(
    SECRET,
    buildImageSigningPayload({ expiresAt, key: KEY, rendition })
  );
  return new Request(
    `https://files.teakvault.com/__images/v1/${rendition}/${encodeURIComponent(KEY)}?exp=${expiresAt}&sig=${signature}`,
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
});
