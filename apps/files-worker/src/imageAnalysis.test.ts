import { describe, expect, test } from "bun:test";
import { analyzeImage } from "./imageAnalysis";
import type { Env } from "./index";
import { FakeBucket, makePng } from "./testsupport";

const KEY = "users/u/cards/c/file/photo.png";
const SVG_KEY = "users/u/cards/c/file/vector.svg";

describe("image analysis", () => {
  test("uses the free Images binding info call for eligible raster dimensions", async () => {
    const bucket = new FakeBucket();
    bucket.objects.set(KEY, {
      bytes: makePng(40, 30),
      httpMetadata: { contentType: "image/png" },
    });
    let infoCalls = 0;
    const env = {
      BUCKET: bucket as unknown as R2Bucket,
      FILES_SIGNING_SECRET: "secret",
      IMAGES: {
        info: async (stream: ReadableStream<Uint8Array>) => {
          infoCalls += 1;
          await new Response(stream).arrayBuffer();
          return { height: 3000, width: 4000 };
        },
      } as unknown as ImagesBinding,
    } as Env;
    const options: Record<string, unknown>[] = [];
    const imageFetch = ((
      _input: RequestInfo | URL,
      init?: RequestInit & { cf?: { image?: Record<string, unknown> } }
    ) => {
      const image = init?.cf?.image ?? {};
      options.push(image);
      if (image.format === "json") {
        throw new Error("eligible images must use IMAGES.info");
      }
      return Promise.resolve(
        new Response(makePng(64, 48), {
          headers: { "content-type": "image/png" },
        })
      );
    }) as unknown as typeof fetch;

    const result = await analyzeImage(
      env,
      KEY,
      "https://files.teakvault.com",
      imageFetch,
      1_800_000_000
    );

    expect(result).toMatchObject({ height: 3000, width: 4000 });
    expect(result.palette.length).toBeGreaterThan(0);
    expect(infoCalls).toBe(1);
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ format: "png", height: 64, width: 64 });
  });

  test("uses Cloudflare metadata and a 64px PNG color sample", async () => {
    const bucket = new FakeBucket();
    bucket.objects.set(KEY, {
      bytes: makePng(400, 300),
      httpMetadata: { contentType: "image/png" },
    });
    const env = {
      BUCKET: bucket as unknown as R2Bucket,
      FILES_SIGNING_SECRET: "secret",
    } as Env;
    const options: Record<string, unknown>[] = [];
    const imageFetch = ((
      _input: RequestInfo | URL,
      init?: RequestInit & { cf?: { image?: Record<string, unknown> } }
    ) => {
      const image = init?.cf?.image ?? {};
      options.push(image);
      return Promise.resolve(
        image.format === "json"
          ? Response.json({ original: { height: 3000, width: 4000 } })
          : new Response(makePng(64, 48), {
              headers: { "content-type": "image/png" },
            })
      );
    }) as unknown as typeof fetch;

    const result = await analyzeImage(
      env,
      KEY,
      "https://files.teakvault.com",
      imageFetch,
      1_800_000_000
    );

    expect(result).toMatchObject({ height: 3000, width: 4000 });
    expect(result.palette.length).toBeGreaterThan(0);
    expect(options).toContainEqual({
      anim: false,
      format: "json",
      "origin-auth": "share-publicly",
    });
    expect(options).toContainEqual({
      anim: false,
      fit: "scale-down",
      format: "png",
      height: 64,
      metadata: "none",
      "origin-auth": "share-publicly",
      width: 64,
    });
  });

  test("rejects missing dimensions instead of storing transformed dimensions", async () => {
    const bucket = new FakeBucket();
    bucket.objects.set(KEY, {
      bytes: makePng(20, 20),
      httpMetadata: { contentType: "image/png" },
    });
    const env = {
      BUCKET: bucket as unknown as R2Bucket,
      FILES_SIGNING_SECRET: "secret",
    } as Env;
    const imageFetch = ((
      _input: RequestInfo | URL,
      init?: RequestInit & { cf?: { image?: Record<string, unknown> } }
    ) =>
      Promise.resolve(
        init?.cf?.image?.format === "json"
          ? Response.json({})
          : new Response(makePng(20, 20))
      )) as unknown as typeof fetch;

    await expect(
      analyzeImage(
        env,
        KEY,
        "https://files.teakvault.com",
        imageFetch,
        1_800_000_000
      )
    ).rejects.toThrow("image_dimensions_missing");
  });

  test("rasterizes SVG sources for original dimensions and palette", async () => {
    const bucket = new FakeBucket();
    bucket.objects.set(SVG_KEY, {
      bytes: new TextEncoder().encode(
        `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><rect width="120" height="80" fill="#ff0000"/></svg>`
      ),
      httpMetadata: { contentType: "application/xml" },
    });
    const env = {
      BUCKET: bucket as unknown as R2Bucket,
      FILES_SIGNING_SECRET: "secret",
    } as Env;

    const result = await analyzeImage(
      env,
      SVG_KEY,
      "https://files.teakvault.com",
      () =>
        Promise.reject(new Error("SVG analysis must not use Image Resizing"))
    );

    expect(result).toMatchObject({ height: 80, width: 120 });
    expect(result.palette).toContain("#FF0000");
  });
});
