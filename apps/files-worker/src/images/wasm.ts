import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";

const wasmCompile = (
  WebAssembly as unknown as {
    compile: (bytes: BufferSource) => Promise<WebAssembly.Module>;
  }
).compile;

type WasmImport = WebAssembly.Module | string;

const resolveWasmModule = async (
  mod: WasmImport
): Promise<WebAssembly.Module> => {
  if (typeof mod !== "string") {
    return mod;
  }
  const bunFile = (
    globalThis as {
      Bun?: {
        file: (path: string) => { arrayBuffer: () => Promise<ArrayBuffer> };
      };
    }
  ).Bun;
  if (!bunFile) {
    throw new Error("wasm_module_unresolvable");
  }
  return await wasmCompile(await bunFile.file(mod).arrayBuffer());
};

let resvgPromise: Promise<void> | null = null;

const ensureResvg = (): Promise<void> => {
  resvgPromise ??= (async () => {
    const resvg = await import("@resvg/resvg-wasm");
    await resvg.initWasm(await resolveWasmModule(resvgWasm));
  })().catch((error: unknown) => {
    resvgPromise = null;
    throw error;
  });
  return resvgPromise;
};

const MAX_SVG_RENDER_EDGE = 2048;
/**
 * The longest a one-pixel strip may be drawn: a thin rule's long side, at
 * four bytes a pixel.
 */
const MAX_SVG_STRIP_EDGE = 65_536;

export const renderSvgToPng = async (
  svgText: string,
  maxEdge = MAX_SVG_RENDER_EDGE
): Promise<{
  bytes: Uint8Array;
  height: number;
  originalHeight: number;
  originalWidth: number;
  width: number;
}> => {
  await ensureResvg();
  const { Resvg } = await import("@resvg/resvg-wasm");
  const font = { defaultFontFamily: "sans-serif", loadSystemFonts: false };
  const natural = new Resvg(svgText, { font });
  const naturalWidth = natural.width;
  const naturalHeight = natural.height;
  const longestEdge = Math.max(naturalWidth, naturalHeight);
  if (!(longestEdge >= 1 && Number.isFinite(longestEdge))) {
    natural.free();
    throw new Error("svg_render_failed");
  }
  const boundedMaxEdge = Math.max(
    1,
    Math.min(MAX_SVG_RENDER_EDGE, Math.round(maxEdge))
  );
  // One scale for both sides, from the longest. A side under half a pixel
  // rounds to zero and resvg refuses it, so a thin rule (1200×4 at 64 px)
  // keeps a short side of one pixel and a long side past `maxEdge`; one so
  // thin that its strip would be millions of pixels long fails instead.
  const shortestEdge = Math.min(naturalWidth, naturalHeight);
  let zoom = Math.min(1, boundedMaxEdge / longestEdge);
  if (shortestEdge * zoom < 1) {
    zoom = 1 / shortestEdge;
  }
  if (!(longestEdge * zoom <= MAX_SVG_STRIP_EDGE)) {
    natural.free();
    throw new Error("svg_render_failed");
  }
  const renderer =
    zoom === 1
      ? natural
      : new Resvg(svgText, { font, fitTo: { mode: "zoom", value: zoom } });
  try {
    const image = renderer.render();
    try {
      return {
        bytes: new Uint8Array(image.asPng()),
        height: image.height,
        originalHeight: naturalHeight,
        originalWidth: naturalWidth,
        width: image.width,
      };
    } finally {
      image.free();
    }
  } finally {
    renderer.free();
    if (renderer !== natural) {
      natural.free();
    }
  }
};
