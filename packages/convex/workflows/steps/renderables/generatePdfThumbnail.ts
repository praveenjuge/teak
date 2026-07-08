"use node";

import Kernel from "@onkernel/sdk";
import { v } from "convex/values";
import { internal } from "../../../_generated/api";
import { internalAction } from "../../../_generated/server";
import {
  buildR2ObjectKey,
  resolveObjectUrl,
  storeObject,
} from "../../../storage/r2";

// Maximum thumbnail width - height will scale proportionally to maintain document aspect ratio
const THUMBNAIL_MAX_WIDTH = 400;

// pdf.js is loaded directly into the headless browser so we render the first
// page ourselves instead of relying on Mozilla's externally hosted viewer.
// The PDF bytes are fetched inside the Kernel VM with Playwright's request
// context (a Node-side request that ignores browser CORS), which avoids the
// cross-origin fetch issues with R2 signed URLs.
const PDFJS_VERSION = "3.11.174";
const PDFJS_LIB_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.js`;
const PDFJS_WORKER_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`;

/**
 * Generate a thumbnail image from the first page of a PDF document.
 * Uses @onkernel/sdk with Playwright + pdf.js to render the PDF in a headless
 * browser. The document is downloaded inside the browser VM so the bytes are
 * never embedded into the code payload sent to Kernel.
 */
export const generatePdfThumbnail = internalAction({
  args: {
    cardId: v.id("cards"),
  },
  returns: v.object({
    success: v.boolean(),
    generated: v.boolean(),
    thumbnailKey: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    try {
      // Get the card to verify it exists and is a PDF document
      const card = await ctx.runQuery(internal.card.getCard.getCardInternal, {
        cardId: args.cardId,
      });

      if (!card) {
        console.log(`[renderables/pdf] Card ${args.cardId} not found`);
        return {
          success: false,
          generated: false,
          error: "card_not_found",
        };
      }

      // Only generate thumbnails for PDF documents
      if (card.type !== "document" || !card.fileKey) {
        console.log(
          `[renderables/pdf] Skipping card ${args.cardId} - not a document or no fileKey`
        );
        return {
          success: true,
          generated: false,
        };
      }

      // Check if it's a PDF based on mimeType
      const mimeType = card.fileMetadata?.mimeType;
      if (mimeType !== "application/pdf") {
        console.log(
          `[renderables/pdf] Skipping card ${args.cardId} - not a PDF (mimeType: ${mimeType})`
        );
        return {
          success: true,
          generated: false,
        };
      }

      // Skip if thumbnail already exists
      if (card.thumbnailKey) {
        console.log(
          `[renderables/pdf] Skipping card ${args.cardId} - thumbnail already exists`
        );
        return {
          success: true,
          generated: false,
          thumbnailKey: card.thumbnailKey,
        };
      }

      const pdfUrl = await resolveObjectUrl(card.fileKey);
      if (!pdfUrl) {
        console.log(
          `[renderables/pdf] Could not get URL for card ${args.cardId}`
        );
        return {
          success: false,
          generated: false,
          error: "missing_storage_url",
        };
      }

      console.log(`[renderables/pdf] Processing PDF for card ${args.cardId}`);

      // Use Kernel with Playwright + pdf.js to render the first page
      const kernel = new Kernel();
      let kernelBrowser: { session_id: string } | undefined;

      try {
        // Create a browser session
        kernelBrowser = await kernel.browsers.create({
          stealth: true,
        });

        // Execute Playwright code that fetches the PDF inside the VM, loads
        // pdf.js, and renders page 1 to a canvas. Fetching the bytes here (via
        // Playwright's request context, which ignores browser CORS) keeps the
        // multi-MB document out of this code payload — only the URL is embedded.
        const response = await kernel.browsers.playwright.execute(
          kernelBrowser.session_id,
          {
            code: `
              await page.setViewportSize({ width: ${THUMBNAIL_MAX_WIDTH + 50}, height: 700 });

              // Fetch the PDF bytes inside the VM (bypasses browser CORS) so the
              // document never has to be inlined into this code string.
              const pdfResponse = await context.request.get(${JSON.stringify(pdfUrl)});
              if (!pdfResponse.ok()) {
                return JSON.stringify({ success: false, error: 'fetch_failed_' + pdfResponse.status() });
              }
              const pdfBuffer = await pdfResponse.body();
              const pdfBase64 = pdfBuffer.toString('base64');

              // Load a blank page and inject the pdf.js library.
              await page.goto('about:blank');
              await page.addScriptTag({ url: ${JSON.stringify(PDFJS_LIB_URL)} });

              const result = await page.evaluate(async ({ pdfBase64, workerSrc, maxWidth }) => {
                try {
                  const pdfjsLib = window['pdfjsLib'];
                  if (!pdfjsLib) {
                    return { success: false, error: 'pdf.js failed to load' };
                  }
                  pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

                  // Decode base64 into a byte array.
                  const binary = atob(pdfBase64);
                  const bytes = new Uint8Array(binary.length);
                  for (let i = 0; i < binary.length; i++) {
                    bytes[i] = binary.charCodeAt(i);
                  }

                  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
                  const pdfPage = await pdf.getPage(1);

                  // Scale the first page down to the target thumbnail width.
                  const baseViewport = pdfPage.getViewport({ scale: 1 });
                  const scale = Math.min(maxWidth / baseViewport.width, 3);
                  const viewport = pdfPage.getViewport({ scale });

                  const canvas = document.createElement('canvas');
                  const ctx = canvas.getContext('2d');
                  if (!ctx) {
                    return { success: false, error: 'Could not get canvas context' };
                  }
                  canvas.width = Math.ceil(viewport.width);
                  canvas.height = Math.ceil(viewport.height);

                  // Flatten transparency onto white so the thumbnail looks like paper.
                  ctx.fillStyle = '#ffffff';
                  ctx.fillRect(0, 0, canvas.width, canvas.height);

                  await pdfPage.render({ canvasContext: ctx, viewport }).promise;

                  const dataUrl = canvas.toDataURL('image/png');
                  return {
                    success: true,
                    data: dataUrl.split(',')[1],
                    width: canvas.width,
                    height: canvas.height,
                  };
                } catch (err) {
                  return { success: false, error: (err && err.message) || 'pdf render error' };
                }
              }, {
                pdfBase64,
                workerSrc: ${JSON.stringify(PDFJS_WORKER_URL)},
                maxWidth: ${THUMBNAIL_MAX_WIDTH}
              });

              return JSON.stringify(result);
            `,
            timeout_sec: 120,
          }
        );

        if (!(response.success && response.result)) {
          console.error(
            `[renderables/pdf] Kernel Playwright execution failed for card ${args.cardId}:`,
            response.error
          );
          return {
            success: false,
            generated: false,
            error: "kernel_execution_failed",
          };
        }

        const result = JSON.parse(response.result as string);

        if (!result.success) {
          console.error(
            `[renderables/pdf] PDF thumbnail generation failed for card ${args.cardId}:`,
            result.error
          );
          return {
            success: false,
            generated: false,
            error: result.error || "thumbnail_generation_failed",
          };
        }

        const base64Screenshot = result.data as string;
        const buffer = Buffer.from(base64Screenshot, "base64");
        const imageArrayBuffer = buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength
        );

        const thumbnailBlob = new Blob([imageArrayBuffer], {
          type: "image/png",
        });
        const thumbnailKey = await storeObject(ctx, thumbnailBlob, {
          key: buildR2ObjectKey({
            userId: card.userId,
            cardId: args.cardId,
            role: "thumbnail",
          }),
          type: "image/png",
        });

        const originalWidth = result.width as number | undefined;
        const originalHeight = result.height as number | undefined;

        // Update the card with the thumbnail (and dimensions for aspect ratio)
        await ctx.runMutation(
          internal.workflows.steps.renderables.mutations.updateCardThumbnail,
          {
            cardId: args.cardId,
            thumbnailKey,
            ...(originalWidth !== undefined && { originalWidth }),
            ...(originalHeight !== undefined && { originalHeight }),
          }
        );

        console.log(
          `[renderables/pdf] Successfully generated thumbnail for card ${args.cardId}`
        );

        return {
          success: true,
          generated: true,
          thumbnailKey,
        };
      } finally {
        // Clean up the browser session
        if (kernelBrowser?.session_id) {
          try {
            await kernel.browsers.deleteByID(kernelBrowser.session_id);
          } catch (cleanupError) {
            console.warn(
              "[renderables/pdf] Failed to cleanup browser session:",
              cleanupError
            );
          }
        }
      }
    } catch (error) {
      console.error(
        `[renderables/pdf] Failed to generate PDF thumbnail for card ${args.cardId}:`,
        error
      );
      // Don't throw - thumbnail generation failure shouldn't break the card creation flow
      return {
        success: false,
        generated: false,
        error: error instanceof Error ? error.message : "unknown_error",
      };
    }
  },
});

/**
 * Manual trigger for PDF thumbnail generation (useful for testing)
 */
export const manualTriggerPdfThumbnail = internalAction({
  args: {
    cardId: v.id("cards"),
  },
  returns: v.object({
    success: v.boolean(),
    message: v.string(),
  }),
  handler: async (ctx, args) => {
    try {
      const result = await ctx.runAction(
        internal.workflows.steps.renderables.generatePdfThumbnail
          .generatePdfThumbnail,
        {
          cardId: args.cardId,
        }
      );
      if (!result.success) {
        return {
          success: false,
          message: `Failed to generate PDF thumbnail: ${result.error || "Unknown error"}`,
        };
      }
      return {
        success: true,
        message: `PDF thumbnail generation initiated for card ${args.cardId}`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to generate PDF thumbnail: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  },
});
