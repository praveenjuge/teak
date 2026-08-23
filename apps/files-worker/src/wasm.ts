// Edge codec loaders for the formats photon cannot handle natively (HEIC,
// SVG, PDF) and the lossy WebP encoder used for all derived images.
//
// Every codec's WASM module is imported statically so Wrangler bundles it via
// the Data rule in wrangler.jsonc; initialization happens lazily on first use
// and is memoized per isolate. See wasm-modules.d.ts for how .wasm imports
// resolve in each runtime.

import heicDecWasm from "@discourse/heic/codec/dec/heic_dec.wasm";
import pdfiumWasm from "@hyzyla/pdfium/pdfium.wasm";
import webpEncWasm from "@jsquash/webp/codec/enc/webp_enc_simd.wasm";
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";

// workers-types omits WebAssembly.compile; reach it via the global object.
const wasmCompile = (
  WebAssembly as unknown as {
    compile: (bytes: BufferSource) => Promise<WebAssembly.Module>;
  }
).compile;

type WasmImport = ArrayBuffer | string;

const wasmBytesCache = new Map<WasmImport, Promise<ArrayBuffer>>();

const resolveWasmBytes = (mod: WasmImport): Promise<ArrayBuffer> => {
  const cached = wasmBytesCache.get(mod);
  if (cached) {
    return cached;
  }
  const promise = (async () => {
    if (typeof mod === "string") {
      // Bun resolves .wasm imports to a file path; read it from disk.
      const bunFile = (
        globalThis as {
          Bun?: {
            file: (path: string) => {
              arrayBuffer: () => Promise<ArrayBuffer>;
            };
          };
        }
      ).Bun;
      if (!bunFile) {
        throw new Error("wasm_module_unresolvable");
      }
      return await bunFile.file(mod).arrayBuffer();
    }
    return mod;
  })();
  wasmBytesCache.set(mod, promise);
  return promise;
};

/** Memoizes a lazy singleton, resetting on failure so a retry can succeed. */
const memoize = <T>(load: () => Promise<T>): (() => Promise<T>) => {
  let promise: Promise<T> | null = null;
  return () => {
    promise ??= load().catch((error: unknown) => {
      promise = null;
      throw error;
    });
    return promise;
  };
};

/** Rendering needs the whole document; refuse larger PDFs (shared with inspect). */
export const MAX_PDF_BYTES = 25 * 1024 * 1024;

/* ------------------------------------------------------------------ *
 * Lossy WebP encoding (@jsquash/webp — libwebp).
 * Replaces photon's get_bytes_webp(), which is a *lossless* encoder and
 * ignores quality entirely.
 * ------------------------------------------------------------------ */

type JsquashEncoderFn = (
  data: { data: Uint8ClampedArray; height: number; width: number },
  options?: { quality?: number }
) => Promise<ArrayBuffer>;

const loadWebpEncoder = memoize(async (): Promise<JsquashEncoderFn> => {
  const encoder = await import("@jsquash/webp/encode.js");
  await encoder.init(await wasmCompile(await resolveWasmBytes(webpEncWasm)));
  return encoder.default as unknown as JsquashEncoderFn;
});

export const encodeImageAsLossyWebp = async (
  pixels: Uint8Array,
  width: number,
  height: number,
  quality: number
): Promise<Uint8Array> => {
  const encoder = await loadWebpEncoder();
  const buffer = await encoder(
    { data: new Uint8ClampedArray(pixels), height, width },
    { quality: Math.max(0, Math.min(100, Math.round(quality))) }
  );
  return new Uint8Array(buffer);
};

/* ------------------------------------------------------------------ *
 * HEIC decoding (@discourse/heic — libheif). Returns raw RGBA pixels.
 * ------------------------------------------------------------------ */

export interface DecodedRgbaImage {
  height: number;
  pixels: Uint8Array;
  width: number;
}

type JsquashDecoderFn = (
  buffer: ArrayBuffer
) => Promise<{ data: Uint8ClampedArray; height: number; width: number }>;

const loadHeicDecoder = memoize(async (): Promise<JsquashDecoderFn> => {
  const decoder = await import("@discourse/heic/decode.js");
  await decoder.init(await wasmCompile(await resolveWasmBytes(heicDecWasm)));
  return decoder.default as unknown as JsquashDecoderFn;
});

export const decodeHeicToRgba = async (
  bytes: Uint8Array
): Promise<DecodedRgbaImage> => {
  const decode = await loadHeicDecoder();
  const decoded = await decode(bytes.slice().buffer);
  return {
    pixels: Uint8Array.from(decoded.data),
    width: decoded.width,
    height: decoded.height,
  };
};

/* ------------------------------------------------------------------ *
 * SVG rasterization (@resvg/resvg-wasm). Returns PNG bytes, which feed
 * straight back into photon via PhotonImage.new_from_byteslice.
 * ------------------------------------------------------------------ */

const MAX_SVG_RENDER_EDGE = 2048;

const ensureResvg = memoize(async () => {
  const resvg = await import("@resvg/resvg-wasm");
  await resvg.initWasm(await resolveWasmBytes(resvgWasm));
});

export const renderSvgToPng = async (
  svgText: string
): Promise<{ bytes: Uint8Array; height: number; width: number }> => {
  await ensureResvg();
  const { Resvg } = await import("@resvg/resvg-wasm");

  const fontOptions = {
    font: { defaultFontFamily: "sans-serif", loadSystemFonts: false },
  } as const;

  // First pass at intrinsic size to learn the declared dimensions; huge
  // canvases are re-rendered bounded below.
  const natural = new Resvg(svgText, { ...fontOptions });
  try {
    const naturalWidth = natural.width;
    const longestEdge = Math.max(natural.width, natural.height);
    if (!(longestEdge >= 1 && Number.isFinite(longestEdge))) {
      throw new Error("svg_render_failed");
    }

    if (longestEdge <= MAX_SVG_RENDER_EDGE) {
      const image = natural.render();
      try {
        return {
          bytes: new Uint8Array(image.asPng()),
          height: image.height,
          width: image.width,
        };
      } finally {
        image.free();
      }
    }

    const scaledValue = Math.max(
      1,
      Math.round((naturalWidth * MAX_SVG_RENDER_EDGE) / longestEdge)
    );
    natural.free();
    const scaled = new Resvg(svgText, {
      ...fontOptions,
      fitTo: { mode: "width", value: scaledValue },
    });
    try {
      const image = scaled.render();
      try {
        return {
          bytes: new Uint8Array(image.asPng()),
          height: image.height,
          width: image.width,
        };
      } finally {
        image.free();
      }
    } finally {
      scaled.free();
    }
  } finally {
    natural.free();
  }
};

/* ------------------------------------------------------------------ *
 * PDF rendering + text extraction (@hyzyla/pdfium — PDFium, MIT).
 * ------------------------------------------------------------------ */

export interface OpenedPdfPage {
  /** Extracted text of the page (synchronous inside pdfium). */
  getText: () => string;
  getOriginalSize: () => { originalHeight: number; originalWidth: number };
  /** Renders the page to RGBA pixels bounded by targetWidth. */
  renderToRgba: (targetWidth: number) => Promise<DecodedRgbaImage>;
}

export interface OpenedPdfDocument {
  destroy: () => void;
  getPage: (index: number) => OpenedPdfPage;
  getPageCount: () => number;
}

interface PdfiumLibraryLike {
  destroy: () => void;
  loadDocument: (data: Uint8Array) => Promise<{
    destroy: () => void;
    getPageCount: () => number;
    getPage: (index: number) => {
      destroy?: () => void;
      getOriginalSize: () => { originalHeight: number; originalWidth: number };
      getText: () => string;
      render: (options: {
        height?: number;
        scale?: number;
        transparent?: boolean;
        width?: number;
      }) => Promise<{ data: Uint8Array; height: number; width: number }>;
    };
  }>;
}

const loadPdfiumLibrary = memoize(async (): Promise<PdfiumLibraryLike> => {
  const { PDFiumLibrary } = await import("@hyzyla/pdfium");
  const library = await PDFiumLibrary.init({
    wasmBinary: await resolveWasmBytes(pdfiumWasm),
  });
  return library as unknown as PdfiumLibraryLike;
});

/** PDFium bitmaps are BGRA; photon expects RGBA. */
const bgraToRgba = (data: Uint8Array): Uint8Array => {
  const rgba = new Uint8Array(data.length);
  for (let offset = 0; offset + 3 < data.length; offset += 4) {
    rgba[offset] = data[offset + 2];
    rgba[offset + 1] = data[offset + 1];
    rgba[offset + 2] = data[offset];
    rgba[offset + 3] = data[offset + 3];
  }
  return rgba;
};

export const openPdf = async (
  bytes: Uint8Array
): Promise<OpenedPdfDocument> => {
  const library = await loadPdfiumLibrary();
  // pdfium's loadDocument requires a typed array view, not a bare buffer.
  const doc = await library.loadDocument(bytes.slice());

  return {
    getPageCount: () => doc.getPageCount(),
    getPage: (pageIndex) => {
      const page = doc.getPage(pageIndex);
      return {
        getOriginalSize: () => page.getOriginalSize(),
        getText: () => page.getText(),
        renderToRgba: async (targetWidth) => {
          // The bitmap must be fully materialized before the underlying page
          // memory goes away, so the render is awaited here and the page is
          // released by the document's destroy().
          const bitmap = await page.render({ width: targetWidth });
          return {
            pixels: bgraToRgba(bitmap.data),
            height: bitmap.height,
            width: bitmap.width,
          };
        },
      };
    },
    destroy: () => {
      // Only the document is released per request; the pdfium library/wasm
      // stays alive for the isolate lifetime (it is memoized above).
      doc.destroy();
    },
  };
};
