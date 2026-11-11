import {
  FILES_PROCESSOR_VERSION,
  type FilesFinalizeImageParams,
  type FilesFinalizeImageResult,
  imageTypeForExtension,
} from "@teak/files-protocol";
import type { Env } from "../index";
import { OpFailure } from "../opFailure";
import { inspectImageContainer } from "./imageContainer";
import {
  imageInfoFromBinding,
  imageInfoFromUrlProbe,
  type RasterInfo,
} from "./imageFacts";
import {
  assertUnchanged,
  isSvgObject,
  renderStoredSvg,
  type SourceVersion,
} from "./svg";

const MAX_CONTAINER_FALLBACK_BYTES = 1024 * 1024;
const MAX_IMAGE_DIMENSION = 10_000;

export interface FinalizeImageFacts {
  decodedFormat: string;
  height: number | null;
  width: number | null;
}

export const normalizeDecodedFormat = (
  raw: string,
  objectKey: string
): string => {
  const normalized = raw.trim().toLowerCase();
  if (normalized.includes("/")) {
    return normalized.startsWith("image/") ? normalized : "";
  }
  return (
    imageTypeForExtension(normalized) ??
    (objectKey.toLowerCase().endsWith(`.${normalized}`)
      ? `image/${normalized}`
      : "")
  );
};

/** The facts of a raster `info`, or null when it isn't a decodable image. */
const rasterFacts = (
  info: RasterInfo,
  sourceKey: string
): FinalizeImageFacts | null => {
  const decodedFormat = normalizeDecodedFormat(info.format, sourceKey);
  return decodedFormat && info.width && info.height
    ? { decodedFormat, height: info.height, width: info.width }
    : null;
};

const factsFromSvg = async (
  bucket: R2Bucket,
  sourceKey: string,
  expected: SourceVersion
): Promise<FinalizeImageFacts> => {
  const rendered = await renderStoredSvg(bucket, sourceKey, 64, expected);
  return {
    decodedFormat: "image/svg+xml",
    height: rendered.originalHeight,
    width: rendered.originalWidth,
  };
};

const factsFromRasterInfo = async (
  env: Env,
  sourceKey: string,
  expected: SourceVersion,
  origin: string,
  imageFetch: typeof fetch,
  now: number
): Promise<FinalizeImageFacts | null> => {
  const bindingInfo = await imageInfoFromBinding(env, sourceKey, expected);
  // The binding gives an SVG no raster dimensions; the URL probe reads them.
  if (bindingInfo && bindingInfo.format !== "image/svg+xml") {
    const facts = rasterFacts(bindingInfo, sourceKey);
    if (!facts) {
      throw new OpFailure("not_an_image");
    }
    return facts;
  }
  const probed = await imageInfoFromUrlProbe(
    env,
    sourceKey,
    origin,
    imageFetch,
    now
  );
  return probed ? rasterFacts(probed, sourceKey) : null;
};

const factsFromValidatedContainer = async (
  bucket: R2Bucket,
  sourceKey: string,
  expected: { httpEtag: string; size: number }
): Promise<FinalizeImageFacts> => {
  if (expected.size > MAX_CONTAINER_FALLBACK_BYTES) {
    throw new OpFailure("not_an_image");
  }
  const object = await bucket.get(sourceKey);
  if (!object) {
    throw new OpFailure("source_not_found");
  }
  assertUnchanged(object, expected);
  const facts = inspectImageContainer(
    new Uint8Array(await object.arrayBuffer())
  );
  if (!facts) {
    throw new OpFailure("not_an_image");
  }
  return facts;
};

export const finalizeImageUpload = async (
  env: Env,
  params: FilesFinalizeImageParams,
  origin: string,
  imageFetch: typeof fetch = fetch,
  now = Math.floor(Date.now() / 1000)
): Promise<FilesFinalizeImageResult> => {
  const sourceKey = params.sourceKey;
  const destinationKey = params.destinationKey;
  const metadata = await env.BUCKET.head(sourceKey);
  if (!metadata) {
    throw new OpFailure("source_not_found");
  }
  const expectedEtag =
    typeof params.expectedEtag === "string" && params.expectedEtag
      ? params.expectedEtag
      : null;
  const expectedSize =
    typeof params.expectedSize === "number" ? params.expectedSize : null;
  if (
    (expectedEtag && metadata.httpEtag !== expectedEtag) ||
    (expectedSize !== null && metadata.size !== expectedSize)
  ) {
    throw new OpFailure("source_changed");
  }

  const facts = isSvgObject(sourceKey, metadata.httpMetadata?.contentType)
    ? await factsFromSvg(env.BUCKET, sourceKey, metadata)
    : ((await factsFromRasterInfo(
        env,
        sourceKey,
        metadata,
        origin,
        imageFetch,
        now
      )) ??
      // Cloudflare can reject a small browser-compatible image as
      // incomplete. Accept that edge case only after validating the
      // complete, bounded container and reading trusted dimensions.
      (await factsFromValidatedContainer(env.BUCKET, sourceKey, metadata)));

  if (
    (facts.width !== null && facts.width > MAX_IMAGE_DIMENSION) ||
    (facts.height !== null && facts.height > MAX_IMAGE_DIMENSION)
  ) {
    throw new OpFailure("image_dimensions_too_large");
  }

  const source = await env.BUCKET.get(sourceKey);
  if (!source) {
    throw new OpFailure("source_not_found");
  }
  if (source.httpEtag !== metadata.httpEtag || source.size !== metadata.size) {
    await source.body.cancel().catch(() => undefined);
    throw new OpFailure("source_changed");
  }
  const stored = await env.BUCKET.put(destinationKey, source.body, {
    httpMetadata: {
      ...source.httpMetadata,
      contentType: facts.decodedFormat,
    },
    customMetadata: {
      ...source.customMetadata,
      decodedFormat: facts.decodedFormat,
      processorVersion: FILES_PROCESSOR_VERSION,
      sourceEtag: source.httpEtag,
    },
  });

  return {
    decodedFormat: facts.decodedFormat,
    destinationKey,
    height: facts.height,
    sourceEtag: source.httpEtag,
    storedEtag: stored.httpEtag,
    storedFileSize: source.size,
    storedMimeType: facts.decodedFormat,
    width: facts.width,
  };
};
