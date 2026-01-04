// @ts-nocheck
import { describe, expect, test, beforeAll, mock } from "bun:test";

let generateHandler: any;

beforeAll(async () => {
  const photonMock = () => ({
    PhotonImage: { new_from_byteslice: () => ({}) },
    SamplingFilter: { Lanczos3: "Lanczos3", Nearest: "Nearest" },
    resize: () => new Uint8Array(),
  });
  mock.module("@cf-wasm/photon", photonMock);
  mock.module("@cf-wasm/photon/dist/workerd.js", photonMock);
  mock.module(
    "/Users/praveenjuge/Projects/teak/node_modules/@cf-wasm/photon/dist/workerd.js",
    photonMock
  );
  let resolvedPhoton: string | null = null;
  try {
    resolvedPhoton = import.meta.resolve("@cf-wasm/photon");
  } catch {
    resolvedPhoton = null;
  }
  if (resolvedPhoton) {
    mock.module(resolvedPhoton, photonMock);
  }
  mock.module("@onkernel/sdk", () => ({
    default: class KernelMock {},
  }));

  generateHandler = (await import("../../../../convex/workflows/steps/renderables")).generateHandler;
});

describe("renderables step", () => {
  const createMockFn = <TArgs extends unknown[], TResult>(
    impl: (...args: TArgs) => TResult | Promise<TResult>
  ) => {
    const calls: TArgs[] = [];
    const fn = (async (...args: TArgs) => {
      calls.push(args);
      return impl(...args);
    }) as ((...args: TArgs) => Promise<TResult>) & { calls: TArgs[] };
    fn.calls = calls;
    return fn;
  };

  describe("error handling", () => {
    test("throws error when card is not found", async () => {
      const mockCtx = {
        runQuery: async () => null,
      };
      await expect(generateHandler(mockCtx, { cardId: "none", cardType: "image" }))
        .rejects.toThrow(/not found/);
    });

    test("handles undefined card gracefully", async () => {
      const mockCtx = {
        runQuery: async () => undefined,
      };
      await expect(generateHandler(mockCtx, { cardId: "undefined-card", cardType: "image" }))
        .rejects.toThrow();
    });
  });

  describe("image thumbnail generation", () => {
    test("generates thumbnail for raster images (PNG)", async () => {
      const runMutation = createMockFn<[any, any], null>(async () => null);
      const mockCtx = {
        runQuery: createMockFn<[any, any], any>(async () => ({
          _id: "card123",
          type: "image",
          fileId: "file123",
          fileMetadata: { mimeType: "image/png" },
          processingStatus: {},
        })),
        runAction: createMockFn<[any, any], any>(async () => ({
          success: true,
          generated: true,
        })),
        runMutation,
      };

      const result = await generateHandler(mockCtx, { cardId: "card123", cardType: "image" });

      expect(result.success).toBe(true);
      expect(result.thumbnailGenerated).toBe(true);
      expect(runMutation.calls.length).toBe(1);
    });

    test("generates thumbnail for JPEG images", async () => {
      const runMutation = createMockFn<[any, any], null>(async () => null);
      const mockCtx = {
        runQuery: createMockFn<[any, any], any>(async () => ({
          _id: "card456",
          type: "image",
          fileId: "file456",
          fileMetadata: { mimeType: "image/jpeg" },
          processingStatus: {},
        })),
        runAction: createMockFn<[any, any], any>(async () => ({
          success: true,
          generated: true,
        })),
        runMutation,
      };

      const result = await generateHandler(mockCtx, { cardId: "card456", cardType: "image" });

      expect(result.thumbnailGenerated).toBe(true);
    });

    test("generates thumbnail for WebP images", async () => {
      const runMutation = createMockFn<[any, any], null>(async () => null);
      const mockCtx = {
        runQuery: createMockFn<[any, any], any>(async () => ({
          _id: "card789",
          type: "image",
          fileId: "file789",
          fileMetadata: { mimeType: "image/webp" },
          processingStatus: {},
        })),
        runAction: createMockFn<[any, any], any>(async () => ({
          success: true,
          generated: true,
        })),
        runMutation,
      };

      const result = await generateHandler(mockCtx, { cardId: "card789", cardType: "image" });

      expect(result.thumbnailGenerated).toBe(true);
    });

    test("handles SVG files separately", async () => {
      const runMutation = createMockFn<[any, any], null>(async () => null);
      const runAction = createMockFn<[any, any], any>(async () => ({
        success: true,
        generated: true,
      }));
      const mockCtx = {
        runQuery: createMockFn<[any, any], any>(async () => ({
          _id: "svg1",
          type: "image",
          fileId: "svgFile1",
          fileMetadata: { mimeType: "image/svg+xml" },
          processingStatus: {},
        })),
        runAction,
        runMutation,
      };

      await generateHandler(mockCtx, { cardId: "svg1", cardType: "image" });

      expect(runAction.calls.length).toBe(1);
      // The first argument is the function reference, second is { cardId }
      expect(runAction.calls[0]?.[1]).toEqual({ cardId: "svg1" });
    });

    test("detects SVG by file extension (lowercase)", async () => {
      const runAction = createMockFn<[any, any], any>(async () => ({
        success: true,
        generated: true,
      }));
      const mockCtx = {
        runQuery: createMockFn<[any, any], any>(async () => ({
          _id: "svg2",
          type: "image",
          fileId: "svgFile2",
          fileMetadata: { fileName: "diagram.svg" },
          processingStatus: {},
        })),
        runAction,
        runMutation: createMockFn<[any, any], null>(async () => null),
      };

      await generateHandler(mockCtx, { cardId: "svg2", cardType: "image" });

      expect(runAction.calls.length).toBe(1);
      expect(runAction.calls[0]?.[1]).toEqual({ cardId: "svg2" });
    });

    test("detects SVG by file extension (uppercase)", async () => {
      const runAction = createMockFn<[any, any], any>(async () => ({
        success: true,
        generated: true,
      }));
      const mockCtx = {
        runQuery: createMockFn<[any, any], any>(async () => ({
          _id: "svg3",
          type: "image",
          fileId: "svgFile3",
          fileMetadata: { fileName: "diagram.SVG" },
          processingStatus: {},
        })),
        runAction,
        runMutation: createMockFn<[any, any], null>(async () => null),
      };

      await generateHandler(mockCtx, { cardId: "svg3", cardType: "image" });

      expect(runAction.calls.length).toBe(1);
      expect(runAction.calls[0]?.[1]).toEqual({ cardId: "svg3" });
    });

    test("skips thumbnail generation when no fileId", async () => {
      const runMutation = createMockFn<[any, any], null>(async () => null);
      const mockCtx = {
        runQuery: createMockFn<[any, any], any>(async () => ({
          _id: "card_no_file",
          type: "image",
          processingStatus: {},
        })),
        runAction: createMockFn<[any, any], any>(async () => ({
          success: true,
          generated: false,
        })),
        runMutation,
      };

      const result = await generateHandler(mockCtx, { cardId: "card_no_file", cardType: "image" });

      expect(result.success).toBe(true);
      expect(result.thumbnailGenerated).toBe(false);
    });
  });

  describe("video thumbnail generation", () => {
    test("generates thumbnail for video cards", async () => {
      const runMutation = createMockFn<[any, any], null>(async () => null);
      const mockCtx = {
        runQuery: createMockFn<[any, any], any>(async () => ({
          _id: "vid1",
          type: "video",
          fileId: "f1",
          processingStatus: {},
        })),
        runAction: createMockFn<[any, any], any>(async () => ({
          success: true,
          generated: true,
        })),
        runMutation,
      };

      const result = await generateHandler(mockCtx, { cardId: "vid1", cardType: "video" });

      expect(result.thumbnailGenerated).toBe(true);
    });

    test("handles video thumbnail generation failure", async () => {
      const runMutation = createMockFn<[any, any], null>(async () => null);
      const mockCtx = {
        runQuery: createMockFn<[any, any], any>(async () => ({
          _id: "vid2",
          type: "video",
          fileId: "f2",
          processingStatus: {},
        })),
        runAction: createMockFn<[any, any], any>(async () => ({
          success: false,
          generated: false,
          error: "video_processing_failed",
        })),
        runMutation,
      };

      const result = await generateHandler(mockCtx, { cardId: "vid2", cardType: "video" });

      expect(result.success).toBe(false);
      expect(result.thumbnailGenerated).toBe(false);
    });

    test("skips video thumbnail when no fileId", async () => {
      const runMutation = createMockFn<[any, any], null>(async () => null);
      const mockCtx = {
        runQuery: createMockFn<[any, any], any>(async () => ({
          _id: "vid_no_file",
          type: "video",
          processingStatus: {},
        })),
        runAction: createMockFn<[any, any], any>(async () => ({
          success: true,
          generated: false,
        })),
        runMutation,
      };

      const result = await generateHandler(mockCtx, { cardId: "vid_no_file", cardType: "video" });

      expect(result.success).toBe(true);
      expect(result.thumbnailGenerated).toBe(false);
    });
  });

  describe("PDF thumbnail generation", () => {
    test("generates thumbnail for PDF documents", async () => {
      const runMutation = createMockFn<[any, any], null>(async () => null);
      const mockCtx = {
        runQuery: createMockFn<[any, any], any>(async () => ({
          _id: "pdf1",
          type: "document",
          fileId: "f1",
          fileMetadata: { mimeType: "application/pdf" },
          processingStatus: {},
        })),
        runAction: createMockFn<[any, any], any>(async () => ({
          success: true,
          generated: true,
        })),
        runMutation,
      };

      const result = await generateHandler(mockCtx, { cardId: "pdf1", cardType: "document" });

      expect(result.thumbnailGenerated).toBe(true);
    });

    test("does not generate thumbnail for non-PDF documents", async () => {
      const runMutation = createMockFn<[any, any], null>(async () => null);
      const runAction = createMockFn<[any, any], any>(async () => ({
        success: true,
        generated: false,
      }));
      const mockCtx = {
        runQuery: createMockFn<[any, any], any>(async () => ({
          _id: "doc1",
          type: "document",
          fileId: "f1",
          fileMetadata: { mimeType: "application/msword" },
          processingStatus: {},
        })),
        runAction,
        runMutation,
      };

      await generateHandler(mockCtx, { cardId: "doc1", cardType: "document" });

      expect(runAction.calls.length).toBe(0);
    });

    test("handles PDF thumbnail generation failure", async () => {
      const runMutation = createMockFn<[any, any], null>(async () => null);
      const mockCtx = {
        runQuery: createMockFn<[any, any], any>(async () => ({
          _id: "pdf2",
          type: "document",
          fileId: "f2",
          fileMetadata: { mimeType: "application/pdf" },
          processingStatus: {},
        })),
        runAction: createMockFn<[any, any], any>(async () => ({
          success: false,
          generated: false,
          error: "pdf_render_failed",
        })),
        runMutation,
      };

      const result = await generateHandler(mockCtx, { cardId: "pdf2", cardType: "document" });

      expect(result.success).toBe(false);
      const mutationArgs = runMutation.calls[0]?.[1] as any;
      expect(mutationArgs?.processingStatus.renderables.status).toBe("failed");
    });

    test("skips PDF thumbnail when no fileId", async () => {
      const runMutation = createMockFn<[any, any], null>(async () => null);
      const mockCtx = {
        runQuery: createMockFn<[any, any], any>(async () => ({
          _id: "pdf_no_file",
          type: "document",
          fileMetadata: { mimeType: "application/pdf" },
          processingStatus: {},
        })),
        runAction: createMockFn<[any, any], any>(async () => ({
          success: true,
          generated: false,
        })),
        runMutation,
      };

      const result = await generateHandler(mockCtx, { cardId: "pdf_no_file", cardType: "document" });

      expect(result.success).toBe(true);
      expect(result.thumbnailGenerated).toBe(false);
    });
  });

  describe("processing status updates", () => {
    test("marks renderables as completed when successful", async () => {
      const runMutation = createMockFn<[any, any], null>(async () => null);
      const mockCtx = {
        runQuery: createMockFn<[any, any], any>(async () => ({
          _id: "card_success",
          type: "image",
          fileId: "f1",
          processingStatus: {},
        })),
        runAction: createMockFn<[any, any], any>(async () => ({
          success: true,
          generated: true,
        })),
        runMutation,
      };

      await generateHandler(mockCtx, { cardId: "card_success", cardType: "image" });

      const mutationArgs = runMutation.calls[0]?.[1] as any;
      expect(mutationArgs?.processingStatus.renderables.status).toBe("completed");
    });

    test("marks renderables as completed when skipped", async () => {
      const runMutation = createMockFn<[any, any], null>(async () => null);
      const mockCtx = {
        runQuery: createMockFn<[any, any], any>(async () => ({
          _id: "card_skip",
          type: "image",
          fileId: "f1",
          processingStatus: {},
        })),
        runAction: createMockFn<[any, any], any>(async () => ({
          success: true,
          generated: false,
        })),
        runMutation,
      };

      await generateHandler(mockCtx, { cardId: "card_skip", cardType: "image" });

      const mutationArgs = runMutation.calls[0]?.[1] as any;
      expect(mutationArgs?.processingStatus.renderables.status).toBe("completed");
    });

    test("marks renderables as failed with error message", async () => {
      const runMutation = createMockFn<[any, any], null>(async () => null);
      const mockCtx = {
        runQuery: createMockFn<[any, any], any>(async () => ({
          _id: "card_fail",
          type: "image",
          fileId: "f1",
          processingStatus: {},
        })),
        runAction: createMockFn<[any, any], any>(async () => ({
          success: false,
          generated: false,
          error: "kernel_execution_failed",
        })),
        runMutation,
      };

      await generateHandler(mockCtx, { cardId: "card_fail", cardType: "image" });

      const mutationArgs = runMutation.calls[0]?.[1] as any;
      expect(mutationArgs?.processingStatus.renderables.status).toBe("failed");
      expect(mutationArgs?.processingStatus.renderables.error).toBe(
        "kernel_execution_failed"
      );
    });

    test("preserves existing processing status fields", async () => {
      const runMutation = createMockFn<[any, any], null>(async () => null);
      const mockCtx = {
        runQuery: createMockFn<[any, any], any>(async () => ({
          _id: "card_preserve",
          type: "image",
          fileId: "f1",
          processingStatus: {
            classify: { status: "completed", confidence: 0.9 },
            metadata: { status: "completed", confidence: 0.95 },
          },
        })),
        runAction: createMockFn<[any, any], any>(async () => ({
          success: true,
          generated: true,
        })),
        runMutation,
      };

      await generateHandler(mockCtx, { cardId: "card_preserve", cardType: "image" });

      const mutationArgs = runMutation.calls[0]?.[1] as any;
      expect(mutationArgs?.processingStatus.classify.status).toBe("completed");
      expect(mutationArgs?.processingStatus.metadata.status).toBe("completed");
      expect(mutationArgs?.processingStatus.renderables.status).toBe("completed");
    });

    test("sets confidence score for successful renderables", async () => {
      const runMutation = createMockFn<[any, any], null>(async () => null);
      const mockCtx = {
        runQuery: createMockFn<[any, any], any>(async () => ({
          _id: "card_conf",
          type: "image",
          fileId: "f1",
          processingStatus: {},
        })),
        runAction: createMockFn<[any, any], any>(async () => ({
          success: true,
          generated: true,
        })),
        runMutation,
      };

      await generateHandler(mockCtx, { cardId: "card_conf", cardType: "image" });

      const mutationArgs = runMutation.calls[0]?.[1] as any;
      expect(mutationArgs?.processingStatus.renderables.confidence).toBe(0.95);
    });
  });

  describe("edge cases", () => {
    test("handles card with missing processing status", async () => {
      const runMutation = createMockFn<[any, any], null>(async () => null);
      const mockCtx = {
        runQuery: createMockFn<[any, any], any>(async () => ({
          _id: "card_no_status",
          type: "image",
          fileId: "f1",
        })),
        runAction: createMockFn<[any, any], any>(async () => ({
          success: true,
          generated: true,
        })),
        runMutation,
      };

      const result = await generateHandler(mockCtx, { cardId: "card_no_status", cardType: "image" });

      expect(result.success).toBe(true);
      const mutationArgs = runMutation.calls[0]?.[1] as any;
      expect(mutationArgs?.processingStatus).toBeDefined();
    });

    test("handles non-image/video/document card types", async () => {
      const runMutation = createMockFn<[any, any], null>(async () => null);
      const mockCtx = {
        runQuery: createMockFn<[any, any], any>(async () => ({
          _id: "card_text",
          type: "text",
          content: "plain text",
          processingStatus: {},
        })),
        runAction: createMockFn<[any, any], any>(async () => ({
          success: true,
          generated: false,
        })),
        runMutation,
      };

      const result = await generateHandler(mockCtx, { cardId: "card_text", cardType: "text" });

      expect(result.success).toBe(true);
      expect(result.thumbnailGenerated).toBe(false);
    });

    test("handles link card type", async () => {
      const runMutation = createMockFn<[any, any], null>(async () => null);
      const mockCtx = {
        runQuery: createMockFn<[any, any], any>(async () => ({
          _id: "card_link",
          type: "link",
          url: "https://example.com",
          processingStatus: {},
        })),
        runAction: createMockFn<[any, any], any>(async () => ({
          success: true,
          generated: false,
        })),
        runMutation,
      };

      const result = await generateHandler(mockCtx, { cardId: "card_link", cardType: "link" });

      expect(result.success).toBe(true);
      expect(result.thumbnailGenerated).toBe(false);
    });

    test("handles quote card type", async () => {
      const runMutation = createMockFn<[any, any], null>(async () => null);
      const mockCtx = {
        runQuery: createMockFn<[any, any], any>(async () => ({
          _id: "card_quote",
          type: "quote",
          content: "famous quote",
          processingStatus: {},
        })),
        runAction: createMockFn<[any, any], any>(async () => ({
          success: true,
          generated: false,
        })),
        runMutation,
      };

      const result = await generateHandler(mockCtx, { cardId: "card_quote", cardType: "quote" });

      expect(result.success).toBe(true);
    });

    test("handles palette card type", async () => {
      const runMutation = createMockFn<[any, any], null>(async () => null);
      const mockCtx = {
        runQuery: createMockFn<[any, any], any>(async () => ({
          _id: "card_palette",
          type: "palette",
          colors: [{ hex: "#ff0000" }],
          processingStatus: {},
        })),
        runAction: createMockFn<[any, any], any>(async () => ({
          success: true,
          generated: false,
        })),
        runMutation,
      };

      const result = await generateHandler(mockCtx, { cardId: "card_palette", cardType: "palette" });

      expect(result.success).toBe(true);
    });

    test("handles audio card type (no renderables)", async () => {
      const runMutation = createMockFn<[any, any], null>(async () => null);
      const mockCtx = {
        runQuery: createMockFn<[any, any], any>(async () => ({
          _id: "card_audio",
          type: "audio",
          fileId: "audio1",
          processingStatus: {},
        })),
        runAction: createMockFn<[any, any], any>(async () => ({
          success: true,
          generated: false,
        })),
        runMutation,
      };

      const result = await generateHandler(mockCtx, { cardId: "card_audio", cardType: "audio" });

      expect(result.success).toBe(true);
      expect(result.thumbnailGenerated).toBe(false);
    });
  });
});
