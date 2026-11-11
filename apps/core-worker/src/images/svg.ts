import { OpFailure } from "../opFailure";
import { renderSvgToPng } from "./wasm";

export const MAX_SVG_SOURCE_BYTES = 10 * 1024 * 1024;

const XML_TYPES = new Set(["application/xml", "text/xml"]);

/**
 * An SVG by its type, or a `.svg` key stored without a type or with a
 * generic XML one. Every image path decides this the same way.
 */
export const isSvgObject = (key: string, contentType?: string): boolean =>
  contentType === "image/svg+xml" ||
  (key.toLowerCase().endsWith(".svg") &&
    (!contentType || XML_TYPES.has(contentType)));

export interface SourceVersion {
  httpEtag: string;
  size: number;
}

export const assertUnchanged = (
  object: SourceVersion,
  expected: SourceVersion
): void => {
  if (object.httpEtag !== expected.httpEtag || object.size !== expected.size) {
    throw new OpFailure("source_changed");
  }
};

/**
 * Renders a stored SVG with resvg (at most `edge` pixels on its long side)
 * and reads its own dimensions. With `expected`, refuses a file that changed.
 */
export const renderStoredSvg = async (
  bucket: R2Bucket,
  key: string,
  edge: number,
  expected?: SourceVersion
) => {
  const object = await bucket.get(key);
  if (!object) {
    throw new OpFailure("source_not_found");
  }
  if (expected) {
    assertUnchanged(object, expected);
  }
  if (object.size > MAX_SVG_SOURCE_BYTES) {
    await object.body.cancel();
    throw new OpFailure("source_too_large");
  }
  return await renderSvgToPng(await object.text(), edge);
};
