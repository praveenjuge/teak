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
  const scaledWidth = Math.max(
    1,
    Math.round((naturalWidth * boundedMaxEdge) / longestEdge)
  );
  const renderer =
    longestEdge <= boundedMaxEdge
      ? natural
      : new Resvg(svgText, {
          font,
          fitTo: { mode: "width", value: scaledWidth },
        });
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
