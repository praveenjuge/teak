// @ts-nocheck
import { beforeAll, describe, expect, mock, test } from "bun:test";

// Captured across the mocked Kernel + storage layer so the assertions can
// inspect exactly how the PDF thumbnail was produced.
let capturedPlaywrightCode = "";
let storedThumbnail: { key: string; type?: string } | null = null;

let generatePdfThumbnail: any;

const THUMB_PNG_BASE64 = Buffer.from("fake-png").toString("base64");

beforeAll(async () => {
  // Kernel headless browser: return a canvas screenshot payload and record the
  // Playwright code so we can assert how the PDF is rendered.
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
                success: true,
                data: THUMB_PNG_BASE64,
                width: 400,
                height: 560,
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
    resolveObjectUrl: (key?: string) =>
      Promise.resolve(key ? "https://signed.r2.example/the-pdf" : null),
    storeObject: (
      _ctx: unknown,
      _blob: unknown,
      opts: { key: string; type?: string }
    ) => {
      storedThumbnail = { key: opts.key, type: opts.type };
      return Promise.resolve("stored-thumbnail-key");
    },
  }));

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
  test("fetches the PDF inside the VM and stores a rendered thumbnail", async () => {
    storedThumbnail = null;
    const { ctx, mutationCalls } = createCtx(pdfCard);

    const result = await generatePdfThumbnail(ctx, { cardId: "card-pdf" });

    expect(result.success).toBe(true);
    expect(result.generated).toBe(true);
    expect(result.thumbnailKey).toBe("stored-thumbnail-key");

    // The signed URL is fetched inside the browser VM via Playwright's request
    // context (the fix for R2 signed-URL CORS) instead of a cross-origin
    // browser fetch, so only the URL — never the document bytes — is embedded.
    expect(capturedPlaywrightCode).toContain("context.request");
    expect(capturedPlaywrightCode).toContain("https://signed.r2.example/the-pdf");

    // A PNG thumbnail is persisted and written back to the card.
    expect(storedThumbnail?.type).toBe("image/png");
    expect(mutationCalls).toHaveLength(1);
    expect(mutationCalls[0]?.args.thumbnailKey).toBe("stored-thumbnail-key");
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
    expect(capturedPlaywrightCode).toContain("const pdfBase64 = pdfBuffer.toString('base64')");
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
