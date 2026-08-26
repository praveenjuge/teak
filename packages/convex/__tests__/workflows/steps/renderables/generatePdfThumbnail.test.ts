// @ts-nocheck
import { beforeAll, describe, expect, mock, test } from "bun:test";
import { crc32, deflateSync, inflateSync } from "node:zlib";

// Captured across the mocked Kernel + storage layer so the assertions can
// inspect exactly how the PDF thumbnail was produced.
let capturedPlaywrightCode = "";
let uploadedThumbnail: { url: string; body?: Buffer } | null = null;
let headObjectCalls: Array<{ op: string; params: Record<string, unknown> }> =
  [];

let generatePdfThumbnail: any;

// Minimal valid one-page A4 PDF (qpdf-checked) used as the fixture bytes that
// flow through the generated browser code.
const FIXTURE_PDF_BASE64 =
  "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA1OTUuMjggODQxLjg5XSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA0IDAgUiA+PiA+PiAvQ29udGVudHMgNSAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iago1IDAgb2JqCjw8IC9MZW5ndGggNDkgPj4Kc3RyZWFtCkJUIC9GMSAyNCBUZiA3MiA3MjAgVGQgKFBERiBUSFVNQk5BSUwgVEVTVCkgVGogRVQKZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyNDcgMDAwMDAgbiAKMDAwMDAwMDMxNyAwMDAwMCBuIAp0cmFpbGVyCjw8IC9TaXplIDYgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjQxNgolJUVPRgo=";

// Functional pdf.js stand-in with the same API surface the generated code uses.
// It validates that the fixture PDF bytes reached pdf.js, computes viewports
// like pdf.js (A4 at 72dpi), and draws the page so the canvas is not blank.
const STUB_PDFJS_SOURCE = `
(function () {
  var W = 595.28, H = 841.89;
  window.pdfjsLib = {
    GlobalWorkerOptions: { workerSrc: '' },
    getDocument: function (params) {
      var data = params.data;
      var isPdf = data && data.length >= 4 &&
        data[0] === 0x25 && data[1] === 0x50 &&
        data[2] === 0x44 && data[3] === 0x46;
      if (!isPdf) {
        return { promise: Promise.reject(new Error('fixture is not a PDF')) };
      }
      return {
        promise: Promise.resolve({
          numPages: 1,
          getPage: function () {
            return Promise.resolve({
              getViewport: function (opts) {
                var scale = opts.scale;
                return { width: W * scale, height: H * scale };
              },
              render: function (opts) {
                opts.canvasContext.fillStyle = '#3366cc';
                opts.canvasContext.fillRect(0, 0, opts.viewport.width, opts.viewport.height);
                return { promise: Promise.resolve() };
              }
            });
          }
        })
      };
    }
  };
})();
`;

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const encodePng = (width: number, height: number, pixels: Buffer): Buffer => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA color type

  const stride = 1 + width * 4;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    pixels.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = deflateSync(raw);

  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([length, typeBuf, data, crc]);
  };

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

const parseHexColor = (value: string): [number, number, number] => {
  const hex = value.replace("#", "");
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
};

const decodePngFirstPixel = (png: Buffer): [number, number, number] => {
  let offset = PNG_SIGNATURE.length;
  let idat: Buffer | null = null;
  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IDAT") {
      idat = data;
    }
    offset += 12 + length;
  }
  if (!idat) {
    throw new Error("PNG has no IDAT chunk");
  }
  const inflated = inflateSync(idat);
  return [inflated[1], inflated[2], inflated[3]];
};

const decodePngSize = (png: Buffer): { width: number; height: number } => {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  return { width, height };
};

// Faithful local executor: runs the exact Playwright code string the thumbnail
// step sends to Kernel, with a stub request context serving the fixture PDF and
// pdf.js sources, and a real canvas shim that encodes rendered pixels to PNG.
const executeGeneratedCode = async (
  code: string,
  options: { pdfBase64: string; libSource: string; workerSource: string }
): Promise<any> => {
  let canvasWidth = 0;
  let canvasHeight = 0;
  let canvasPixels = Buffer.alloc(0);
  const fillState = { fillStyle: "#000000" };
  const resizeCanvas = () => {
    canvasPixels = Buffer.alloc(canvasWidth * canvasHeight * 4);
    canvasPixels.fill(255);
  };

  const previousWindow = (globalThis as any).window;
  const previousDocument = (globalThis as any).document;
  (globalThis as any).window = {};
  (globalThis as any).document = {
    createElement: (tag: string) => {
      if (tag !== "canvas") {
        return {};
      }
      return {
        get width() {
          return canvasWidth;
        },
        set width(value: number) {
          canvasWidth = Math.max(0, Math.floor(value));
          resizeCanvas();
        },
        get height() {
          return canvasHeight;
        },
        set height(value: number) {
          canvasHeight = Math.max(0, Math.floor(value));
          resizeCanvas();
        },
        getContext: () => ({
          get fillStyle() {
            return fillState.fillStyle;
          },
          set fillStyle(value: string) {
            fillState.fillStyle = value;
          },
          fillRect: (x: number, y: number, w: number, h: number) => {
            const [r, g, b] = parseHexColor(fillState.fillStyle);
            const x0 = Math.max(0, Math.floor(x));
            const y0 = Math.max(0, Math.floor(y));
            const x1 = Math.min(canvasWidth, Math.ceil(x + w));
            const y1 = Math.min(canvasHeight, Math.ceil(y + h));
            for (let py = y0; py < y1; py += 1) {
              for (let px = x0; px < x1; px += 1) {
                const index = (py * canvasWidth + px) * 4;
                canvasPixels[index] = r;
                canvasPixels[index + 1] = g;
                canvasPixels[index + 2] = b;
                canvasPixels[index + 3] = 255;
              }
            }
          },
        }),
        toDataURL: () =>
          `data:image/png;base64,${encodePng(canvasWidth, canvasHeight, canvasPixels).toString("base64")}`,
      };
    },
  };

  try {
    const page = {
      setViewportSize: async () => {},
      goto: async () => {},
      evaluate: async (fn: (...args: never[]) => unknown, ...args: never[]) =>
        fn(...args),
    };
    const context = {
      request: {
        put: (url: string, init: { data: Buffer }) => {
          uploadedThumbnail = { body: init.data, url };
          return {
            headers: () => ({ etag: '"fake-etag"' }),
            ok: () => true,
            status: () => 200,
          };
        },
        get: (url: string) => {
          if (url.includes("the-pdf")) {
            return {
              ok: () => true,
              body: async () => Buffer.from(options.pdfBase64, "base64"),
            };
          }
          if (url.includes("pdf.worker.min.js")) {
            return { ok: () => true, text: async () => options.workerSource };
          }
          if (url.includes("pdf.min.js")) {
            return { ok: () => true, text: async () => options.libSource };
          }
          return { ok: () => false };
        },
      },
    };
    const runner = new Function(
      "page",
      "context",
      `return (async () => {\n${code}\n})()`
    );
    return await runner(page, context);
  } finally {
    (globalThis as any).window = previousWindow;
    (globalThis as any).document = previousDocument;
  }
};

beforeAll(async () => {
  // Kernel headless browser: return the direct-upload result shape and record
  // the Playwright code so we can assert how the PDF is rendered.
  mock.module("@onkernel/sdk", () => ({
    default: class KernelMock {
      browsers = {
        create: () => Promise.resolve({ session_id: "session-1" }),
        deleteByID: () => Promise.resolve(undefined),
        playwright: {
          execute: (_sessionId: string, opts: { code: string }) => {
            capturedPlaywrightCode = opts.code;
            return Promise.resolve({
              success: true,
              result: JSON.stringify({
                etag: '"fake-etag"',
                height: 560,
                success: true,
                width: 400,
              }),
            });
          },
        },
      };
    },
  }));

  // Replace the R2 storage layer so the test never touches the network/S3.
  const r2Path = import.meta.resolve("../../../../storage/r2");
  mock.module(r2Path, () => ({
    buildR2ObjectKey: () => "users/u/cards/c/thumbnail/generated",
    hmacSha256Hex: async () => "fake-hex-signature",
    resolveObjectUrl: (key?: string) =>
      Promise.resolve(key ? "https://signed.r2.example/the-pdf" : null),
  }));

  // Files Worker client: mint deterministic signed URLs and verify committed
  // objects so the direct-upload path can be asserted without a network.
  mock.module(
    import.meta.resolve("../../../../storage/filesWorkerClient"),
    () => ({
      buildSignedWorkerUploadUrl: async ({ key }: { key: string }) => ({
        expiresAt: 123,
        key,
        url: `https://files.teakvault.com/__upload/v1/${encodeURIComponent(key)}?exp=123&sig=fake`,
      }),
      callFilesWorkerJson: (spec: {
        op: string;
        params: Record<string, unknown>;
      }) => {
        headObjectCalls.push(spec);
        return Promise.resolve({
          kind: "ok",
          data: {
            contentType: "image/png",
            etag: '"fake-etag"',
            exists: true,
            size: 1024,
          },
        });
      },
      isFilesWorkerConfigured: () => true,
    })
  );

  generatePdfThumbnail = (
    await import("../../../../workflows/steps/renderables/generatePdfThumbnail")
  ).generatePdfThumbnail;
});

const pdfCard = {
  _id: "card-pdf",
  userId: "user-1",
  type: "document",
  fileKey: "users/u/cards/c/file/original",
  fileMetadata: { mimeType: "application/pdf" },
};

const createCtx = (card: unknown) => {
  const mutationCalls: Array<{ ref: unknown; args: any }> = [];
  return {
    ctx: {
      runQuery: () => Promise.resolve(card),
      runMutation: (ref: unknown, args: any) => {
        mutationCalls.push({ ref, args });
        return Promise.resolve(null);
      },
    },
    mutationCalls,
  };
};

describe("generatePdfThumbnail", () => {
  test("fetches the PDF inside the VM and uploads the thumbnail directly", async () => {
    uploadedThumbnail = null;
    headObjectCalls = [];
    const { ctx, mutationCalls } = createCtx(pdfCard);

    const result = await generatePdfThumbnail(ctx, { cardId: "card-pdf" });

    expect(result.success).toBe(true);
    expect(result.generated).toBe(true);
    expect(result.thumbnailKey).toBe("users/u/cards/c/thumbnail/generated");

    // The signed URL is fetched inside the browser VM via Playwright's request
    // context (the fix for R2 signed-URL CORS) instead of a cross-origin
    // browser fetch, so only the URL — never the document bytes — is embedded.
    expect(capturedPlaywrightCode).toContain("context.request");
    expect(capturedPlaywrightCode).toContain(
      "https://signed.r2.example/the-pdf"
    );

    // The rendered PNG uploads straight from the VM to the Files Worker, and
    // the committed object is verified before the card records it.
    expect(capturedPlaywrightCode).toContain(
      "/__upload/v1/users%2Fu%2Fcards%2Fc%2Fthumbnail%2Fgenerated"
    );
    expect(headObjectCalls).toHaveLength(1);
    expect(headObjectCalls[0]?.op).toBe("head-object");
    expect(mutationCalls).toHaveLength(1);
    expect(mutationCalls[0]?.args.thumbnailKey).toBe(
      "users/u/cards/c/thumbnail/generated"
    );
  });

  test("never inlines the PDF bytes into the Kernel code payload", async () => {
    // Regression (Greptile P1): embedding the full base64 PDF into the
    // Playwright source made large-but-valid PDFs exceed the execute payload
    // limit and fail before pdf.js could render. The document must be fetched
    // inside the VM, so the code passes the bytes as a runtime variable rather
    // than interpolating a giant literal string.
    const { ctx } = createCtx(pdfCard);
    await generatePdfThumbnail(ctx, { cardId: "card-pdf" });

    // The base64 payload is a runtime variable, not a quoted literal.
    expect(capturedPlaywrightCode).not.toContain("pdfBase64: '");
    expect(capturedPlaywrightCode).toContain(
      "const pdfBase64 = pdfBuffer.toString('base64')"
    );
  });

  test("renders via injected pdf.js, never the external Mozilla viewer", async () => {
    // Regression guard: the previous implementation loaded the signed storage
    // URL inside Mozilla's hosted pdf.js viewer, which broke once files moved
    // to R2 (no CORS on signed URLs). Rendering must stay self-contained.
    const { ctx } = createCtx(pdfCard);
    await generatePdfThumbnail(ctx, { cardId: "card-pdf" });

    expect(capturedPlaywrightCode).not.toContain("mozilla.github.io");
    expect(capturedPlaywrightCode).not.toContain("viewer.html");
    expect(capturedPlaywrightCode.toLowerCase()).toContain("pdfjslib");
  });

  test("loads pdf.js in-page instead of relying on addScriptTag", async () => {
    // Regression: page.addScriptTag does not execute in the Kernel headless
    // runtime, so pdfjsLib stayed undefined and no thumbnail was produced.
    // The library and worker are now fetched through the request context and
    // evaluated inside the page.
    const { ctx } = createCtx(pdfCard);
    await generatePdfThumbnail(ctx, { cardId: "card-pdf" });

    expect(capturedPlaywrightCode).not.toContain("addScriptTag({ url:");
    expect(capturedPlaywrightCode).toContain("libSource");
    expect(capturedPlaywrightCode).toContain("(0, eval)(libSource)");
    expect(capturedPlaywrightCode).toContain("GlobalWorkerOptions.workerSrc");
  });

  test("executes the generated browser code and renders a PNG from the fixture PDF", async () => {
    // Execution-level regression guard: the Kernel mock above only records the
    // code string, so string assertions alone cannot catch a broken render
    // pipeline. Run the exact generated code through a faithful local executor
    // with the fixture PDF and assert a real PNG is produced.
    const { ctx } = createCtx(pdfCard);
    await generatePdfThumbnail(ctx, { cardId: "card-pdf" });

    const raw = await executeGeneratedCode(capturedPlaywrightCode, {
      pdfBase64: FIXTURE_PDF_BASE64,
      libSource: STUB_PDFJS_SOURCE,
      workerSource: "",
    });
    const result = JSON.parse(raw);

    expect(result.success).toBe(true);
    expect(result.width).toBe(1132);
    expect(result.height).toBe(1600);

    // The rendered PNG is PUT straight to the signed Files Worker URL.
    const png = uploadedThumbnail?.body;
    expect(uploadedThumbnail?.url).toContain("/__upload/v1/");
    expect(png?.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    expect(decodePngSize(png as Buffer)).toEqual({
      width: 1132,
      height: 1600,
    });
    // The stub pdf.js paints the page blue, so a blue first pixel proves the
    // render call actually executed and was serialized by toDataURL.
    expect(decodePngFirstPixel(png as Buffer)).toEqual([0x33, 0x66, 0xcc]);
  });

  test("fails cleanly when pdf.js cannot be evaluated", async () => {
    // Guards the failure path directly: if libSource is missing (or the eval
    // is removed and pdfjsLib never initializes), the code must report a
    // controlled error instead of throwing.
    const { ctx } = createCtx(pdfCard);
    await generatePdfThumbnail(ctx, { cardId: "card-pdf" });

    const raw = await executeGeneratedCode(capturedPlaywrightCode, {
      pdfBase64: FIXTURE_PDF_BASE64,
      libSource: "",
      workerSource: "",
    });
    const result = JSON.parse(raw);

    expect(result.success).toBe(false);
    expect(result.error).toBe("pdf.js failed to load");
  });

  test("skips non-PDF documents without generating a thumbnail", async () => {
    const { ctx, mutationCalls } = createCtx({
      ...pdfCard,
      fileMetadata: { mimeType: "application/msword" },
    });

    const result = await generatePdfThumbnail(ctx, { cardId: "card-pdf" });

    expect(result.success).toBe(true);
    expect(result.generated).toBe(false);
    expect(mutationCalls).toHaveLength(0);
  });
});
