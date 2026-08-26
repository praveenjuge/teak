import { describe, expect, test } from "bun:test";
import { finalizeImageUpload, normalizeDecodedFormat } from "./finalizeImage";
import { FakeBucket, makePng } from "./testsupport";

const SECRET = "finalize-test-secret";
const NOW = 1_800_000_000;
const SOURCE_KEY = "users/u1/cards/pending/file/photo.png";
const DEST_KEY = "users/u1/cards/stored/file/photo.png";

interface BindingInfo {
  format: string;
  height: number;
  width: number;
}

const makeEnv = ({
  bytes = makePng(32, 24),
  contentType = "image/png",
  info,
}: {
  bytes?: Uint8Array;
  contentType?: string;
  info: BindingInfo | Error | null;
}) => {
  const bucket = new FakeBucket();
  bucket.objects.set(SOURCE_KEY, { bytes, httpMetadata: { contentType } });
  return {
    BUCKET: bucket as unknown as R2Bucket,
    FILES_SIGNING_SECRET: SECRET,
    IMAGES: {
      info: () => {
        if (info instanceof Error) {
          return Promise.reject(info);
        }
        if (info === null) {
          return Promise.reject(new Error("9412: not an image"));
        }
        return Promise.resolve({ ...info, fileSize: bytes.length });
      },
    },
  } as unknown as Parameters<typeof finalizeImageUpload>[0];
};

const failingProbe = (async () =>
  new Response(null, { status: 503 })) as typeof fetch;

const runOp = async (
  env: ReturnType<typeof makeEnv>,
  params: Record<string, unknown> = {},
  imageFetch: typeof fetch = failingProbe
) =>
  await finalizeImageUpload(
    env,
    {
      destinationKey: DEST_KEY,
      sourceKey: SOURCE_KEY,
      ...params,
    },
    "https://files.teakvault.com",
    imageFetch,
    NOW
  );

describe("finalize-image-upload", () => {
  test("commits a decodable image and returns trusted facts", async () => {
    const env = makeEnv({ info: { format: "png", height: 24, width: 32 } });
    const result = await runOp(env);

    expect(result.decodedFormat).toBe("image/png");
    expect(result.width).toBe(32);
    expect(result.height).toBe(24);
    expect(result.destinationKey).toBe(DEST_KEY);
    expect(result.storedFileSize).toBe(makePng(32, 24).length);
    expect((env.BUCKET as unknown as FakeBucket).storedBytes(DEST_KEY)).toEqual(
      makePng(32, 24)
    );
    const put =
      (env.BUCKET as unknown as FakeBucket).puts.find(
        (entry) => entry.key === DEST_KEY
      ) ?? null;
    expect(put?.httpMetadata).toEqual({ contentType: "image/png" });
  });

  test("rejects spoofed MIME types that do not decode as images", async () => {
    const env = makeEnv({
      contentType: "text/plain",
      info: { format: "text", height: 10, width: 10 },
    });
    await expect(runOp(env)).rejects.toThrow("not_an_image");
  });

  test("rejects corrupt images when neither the binding nor the probe can decode them", async () => {
    const env = makeEnv({
      bytes: new Uint8Array([1, 2, 3]),
      info: new Error("decode failed"),
    });
    // The URL probe fallback also fails for undecodable bytes.
    await expect(runOp(env)).rejects.toThrow("not_an_image");
  });

  test("rejects oversized dimensions", async () => {
    const env = makeEnv({
      info: { format: "jpeg", height: 24_000, width: 20_000 },
    });
    await expect(runOp(env)).rejects.toThrow("image_dimensions_too_large");
  });

  test("detects source changes between upload and finalization", async () => {
    const env = makeEnv({ info: { format: "png", height: 24, width: 32 } });
    await expect(runOp(env, { expectedSize: 999_999 })).rejects.toThrow(
      "source_changed"
    );
  });

  test("refuses to promote bytes replaced after decode verification", async () => {
    const bucket = new FakeBucket();
    const png = makePng(32, 24);
    bucket.objects.set(SOURCE_KEY, {
      bytes: png,
      httpMetadata: { contentType: "image/png" },
    });
    let decodeCount = 0;
    const env = {
      BUCKET: bucket as unknown as R2Bucket,
      FILES_SIGNING_SECRET: SECRET,
      IMAGES: {
        info: (stream: ReadableStream<Uint8Array>) => {
          decodeCount += 1;
          void stream.cancel();
          if (decodeCount === 1) {
            // The verified read; a concurrent writer replaces the key right
            // after decoding completes.
            bucket.objects.set(SOURCE_KEY, {
              bytes: new TextEncoder().encode("malicious replacement"),
              httpMetadata: { contentType: "text/plain" },
            });
          }
          return Promise.resolve({
            fileSize: png.length,
            format: "png",
            height: 24,
            width: 32,
          });
        },
      },
    } as unknown as Parameters<typeof finalizeImageUpload>[0];

    await expect(runOp(env)).rejects.toThrow("source_changed");
    expect(bucket.storedBytes(DEST_KEY)).toBeNull();
  });

  test("normalizes decoded format tokens into image MIME types", () => {
    expect(normalizeDecodedFormat("image/webp", "a.webp")).toBe("image/webp");
    expect(normalizeDecodedFormat("heic", "a.heic")).toBe("image/heic");
    expect(normalizeDecodedFormat("jpeg", "a.jpg")).toBe("image/jpeg");
    expect(normalizeDecodedFormat("text/plain", "a.png")).toBe("");
    expect(normalizeDecodedFormat("", "a.png")).toBe("");
  });
});
