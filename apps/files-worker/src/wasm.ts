// Edge codec loaders for the formats photon cannot handle natively (HEIC,
// SVG) and the lossy WebP encoder used for all derived images.
//
// Every codec's WASM module is imported statically. Wrangler precompiles
// .wasm imports into WebAssembly.Modules at build time (workerd forbids
// runtime code generation), while Bun resolves them to file paths for tests.
// Initialization happens lazily on first use and is memoized per isolate.
// See wasm-modules.d.ts for how .wasm imports resolve in each runtime.

import heicDecWasm from "@discourse/heic/codec/dec/heic_dec.wasm";
import webpEncWasm from "@jsquash/webp/codec/enc/webp_enc_simd.wasm";
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";

// workers-types omits WebAssembly.compile; reach it via the global object.
const wasmCompile = (
  WebAssembly as unknown as {
    compile: (bytes: BufferSource) => Promise<WebAssembly.Module>;
  }
).compile;

type WasmImport = WebAssembly.Module | string;

const wasmModuleCache = new Map<WasmImport, Promise<WebAssembly.Module>>();

/**
 * Wrangler hands statically imported .wasm through as ready-to-use
 * WebAssembly.Modules; Bun (tests) resolves them to file paths, which are
 * read and compiled there — runtime codegen is fine under Bun, just not on
 * the Workers runtime.
 */
const resolveWasmModule = (mod: WasmImport): Promise<WebAssembly.Module> => {
  const cached = wasmModuleCache.get(mod);
  if (cached) {
    return cached;
  }
  const promise = (async () => {
    if (typeof mod === "string") {
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
      return await wasmCompile(await bunFile.file(mod).arrayBuffer());
    }
    return mod;
  })();
  wasmModuleCache.set(mod, promise);
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
  await encoder.init(await resolveWasmModule(webpEncWasm));
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
  await decoder.init(await resolveWasmModule(heicDecWasm));
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
  await resvg.initWasm(await resolveWasmModule(resvgWasm));
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
