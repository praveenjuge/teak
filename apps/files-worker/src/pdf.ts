// Edge PDF processing for the process-pdf op: renders the first page of a
// card's PDF straight from the R2 binding (via pdfium) and writes a bounded
// lossy-WebP thumbnail back to R2, returning page count, first-page
// dimensions, a dominant-color palette, and a thumbhash placeholder — all in
// one pass, without the document transiting Convex.
//
// Mirrors the thumbnail sizing rules in generateThumbnail.ts; the legacy
// Kernel/Playwright fallback remains wired on the Convex side.

import { PhotonImage, resize, SamplingFilter } from "@cf-wasm/photon";
import { rgbaToThumbHash } from "thumbhash";
import { computePalette } from "./image";
import { encodeImageAsLossyWebp, MAX_PDF_BYTES, openPdf } from "./wasm";

export const THUMBNAIL_MAX_WIDTH = 500;

const THUMBHASH_MAX_EDGE = 64;
const MAX_COLORS = 5;

export class PdfSourceMissing extends Error {
  constructor() {
    super("source_not_found");
  }
}

export class PdfTooLarge extends Error {
  constructor() {
    super("source_too_large");
  }
}

export interface ProcessPdfResult {
  height: number;
  pageCount: number;
  palette: string[];
  thumbhash: string | null;
  thumbnailGenerated: boolean;
  thumbnailKey: string | null;
  width: number;
}

const toBase64 = (bytes: Uint8Array): string =>
  btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));

/** Longest-edge fit within bounds, minimum 1px. */
const fitWithin = (
  width: number,
  height: number,
  maxEdge: number
): { height: number; width: number } => {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    height: Math.max(1, Math.round(height * scale)),
    width: Math.max(1, Math.round(width * scale)),
  };
};

export const processPdf = async (
  bucket: R2Bucket,
  key: string,
  destKey: string | null
): Promise<ProcessPdfResult> => {
  const object = await bucket.get(key);
  if (!object) {
    throw new PdfSourceMissing();
  }
  if ((object.size ?? 0) > MAX_PDF_BYTES) {
    await object.body.cancel();
    throw new PdfTooLarge();
  }
  const bytes = new Uint8Array(await object.arrayBuffer());

  let doc: Awaited<ReturnType<typeof openPdf>>;
  try {
    doc = await openPdf(bytes);
  } catch {
    throw new Error("pdf_parse_failed");
  }

  try {
    const pageCount = doc.getPageCount();
    if (pageCount < 1) {
      throw new Error("pdf_parse_failed");
    }

    // First-page facts at natural size (points).
    const firstPage = doc.getPage(0);
    const originalSize = firstPage.getOriginalSize();
    const width = Math.max(1, Math.round(originalSize.originalWidth));
    const height = Math.max(1, Math.round(originalSize.originalHeight));

    // Render bounded by the thumbnail width; pdfium keeps the aspect ratio.
    const rendered = await doc
      .getPage(0)
      .renderToRgba(Math.min(THUMBNAIL_MAX_WIDTH, Math.max(1, width)));
    const image = new PhotonImage(
      rendered.pixels,
      rendered.width,
      rendered.height
    );

    let palette: string[] = [];
    let thumbhash: string | null = null;
    let hashImage: PhotonImage | null = null;
    try {
      palette = computePalette(image.get_raw_pixels(), MAX_COLORS);

      try {
        const hashFit = fitWithin(
          rendered.width,
          rendered.height,
          THUMBHASH_MAX_EDGE
        );
        hashImage =
          hashFit.width === rendered.width && hashFit.height === rendered.height
            ? image
            : resize(
                image,
                hashFit.width,
                hashFit.height,
                SamplingFilter.Triangle
              );
        thumbhash = toBase64(
          rgbaToThumbHash(
            hashImage.get_width(),
            hashImage.get_height(),
            hashImage.get_raw_pixels()
          )
        );
      } catch {
        thumbhash = null;
      }

      if (!destKey) {
        return {
          height,
          pageCount,
          palette,
          thumbhash,
          thumbnailGenerated: false,
          thumbnailKey: null,
          width,
        };
      }

      const outputBytes = await encodeImageAsLossyWebp(
        image.get_raw_pixels(),
        rendered.width,
        rendered.height,
        75
      );
      const blob = new Blob([outputBytes], { type: "image/webp" });
      await bucket.put(destKey, blob, {
        httpMetadata: { contentType: "image/webp" },
      });

      return {
        height,
        pageCount,
        palette,
        thumbhash,
        thumbnailGenerated: true,
        thumbnailKey: destKey,
        width,
      };
    } finally {
      if (hashImage !== null && hashImage !== image) {
        hashImage.free();
      }
      image.free();
    }
  } finally {
    doc.destroy();
  }
};
