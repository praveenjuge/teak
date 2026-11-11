import type { Env } from "../index";
import { OpFailure } from "../opFailure";
import { throughImagesBinding } from "./imagesBinding";
import { fetchPrivateImageSource } from "./imageTransform";
import { assertUnchanged, type SourceVersion } from "./svg";

export interface RasterInfo {
  /** As Cloudflare reports it: a MIME type or a format token. */
  format: string;
  height: number | null;
  width: number | null;
}

const positiveDimension = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;

/** Reads the Images binding's `info` and the `format=json` transform alike. */
export const readCloudflareImageInfo = (value: unknown): RasterInfo | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const info = value as {
    format?: unknown;
    height?: unknown;
    original?: { height?: unknown; width?: unknown };
    width?: unknown;
  };
  return {
    format: typeof info.format === "string" ? info.format : "",
    height: positiveDimension(info.original?.height ?? info.height),
    width: positiveDimension(info.original?.width ?? info.width),
  };
};

/**
 * The free Images binding's info, or null when it is missing, the file is
 * over its input limit, changed since `expected`, or can't be read.
 */
export const imageInfoFromBinding = (
  env: Env,
  key: string,
  expected: SourceVersion
): Promise<RasterInfo | null> =>
  throughImagesBinding(
    env.IMAGES,
    expected.size,
    async () => {
      const object = await env.BUCKET.get(key);
      if (!object) {
        throw new OpFailure("source_not_found");
      }
      return object;
    },
    async (images, object) => {
      assertUnchanged(object, expected);
      return readCloudflareImageInfo(await images.info(object.body));
    }
  );

/** Image Resizing's `format=json` info, or null when it answers an error. */
export const imageInfoFromUrlProbe = async (
  env: Env,
  key: string,
  origin: string,
  imageFetch: typeof fetch,
  now: number
): Promise<RasterInfo | null> => {
  const response = await fetchPrivateImageSource(
    env,
    origin,
    key,
    { anim: false, format: "json" },
    imageFetch,
    now
  );
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  return readCloudflareImageInfo(await response.json());
};
