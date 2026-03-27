"use node";

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import Kernel from "@onkernel/sdk";
import { v } from "convex/values";
import { internal } from "../../../_generated/api";
import { internalAction } from "../../../_generated/server";
import { getStorageUrl, storeBlobInR2 } from "../../../fileStorage";
import { storageRefValidator } from "../../../storageRefs";

// Maximum thumbnail width - height will scale proportionally to maintain document aspect ratio
const THUMBNAIL_MAX_WIDTH = 400;
const require = createRequire(import.meta.url);

let pdfJsBundlePromise: Promise<string> | undefined;
let pdfJsWorkerBundlePromise: Promise<string> | undefined;

async function getPdfJsBundle() {
  pdfJsBundlePromise ??= readFile(
    require.resolve("pdfjs-dist/build/pdf.min.js"),
    "utf8"
  );
  return pdfJsBundlePromise;
}

async function getPdfJsWorkerBundle() {
  pdfJsWorkerBundlePromise ??= readFile(
    require.resolve("pdfjs-dist/build/pdf.worker.min.js"),
    "utf8"
  );
  return pdfJsWorkerBundlePromise;
}

/**
 * Generate a thumbnail image from the first page of a PDF document.
 * Uses @onkernel/sdk with Playwright to render the PDF in a headless browser.
 */
export const generatePdfThumbnail = internalAction({
  args: {
    cardId: v.id("cards"),
  },
  returns: v.object({
    success: v.boolean(),
    generated: v.boolean(),
    thumbnailId: v.optional(storageRefValidator),
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
      if (card.type !== "document" || !card.fileId) {
        console.log(
          `[renderables/pdf] Skipping card ${args.cardId} - not a document or no fileId`
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
      if (card.thumbnailId) {
        console.log(
          `[renderables/pdf] Skipping card ${args.cardId} - thumbnail already exists`
        );
        return {
          success: true,
          generated: false,
          thumbnailId: card.thumbnailId,
        };
      }

      // Get the PDF URL from storage
      const pdfUrl = await getStorageUrl(ctx, card.fileId);
      if (!pdfUrl) {
        console.log(
          `[renderables/pdf] Could not get URL for fileId ${card.fileId}`
        );
        return {
          success: false,
          generated: false,
          error: "missing_storage_url",
        };
      }

      console.log(`[renderables/pdf] Processing PDF for card ${args.cardId}`);

      const [pdfJsBundle, pdfJsWorkerBundle] = await Promise.all([
        getPdfJsBundle(),
        getPdfJsWorkerBundle(),
      ]);

      // Use Kernel with Playwright to render the PDF
      const kernel = new Kernel();
      let kernelBrowser: { session_id: string } | undefined;

      try {
        // Create a browser session
        kernelBrowser = await kernel.browsers.create({
          stealth: true,
        });

        // Execute Playwright code to render the first PDF page directly.
        // Avoid depending on a hosted viewer DOM structure, which is brittle.
        const response = await kernel.browsers.playwright.execute(
          kernelBrowser.session_id,
          {
            code: `
              await page.setViewportSize({ width: ${THUMBNAIL_MAX_WIDTH + 50}, height: 700 });

              await page.goto('about:blank');
              await page.setContent('<!doctype html><html><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#fff;"></body></html>');

              await page.addScriptTag({
                content: ${JSON.stringify(pdfJsBundle)}
              });

              const result = await page.evaluate(async ({ pdfUrl, maxWidth, workerScript }) => {
                const renderPdf = async () => {
                  const pdfjsLib = window.pdfjsLib;
                  if (!pdfjsLib) {
                    return { success: false, error: 'pdfjs_not_loaded' };
                  }

                  const workerBlob = new Blob([workerScript], {
                    type: 'text/javascript',
                  });
                  const workerUrl = URL.createObjectURL(workerBlob);
                  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

                  try {
                    const loadingTask = pdfjsLib.getDocument({
                      url: pdfUrl,
                      withCredentials: false,
                    });

                    const pdf = await loadingTask.promise;
                    const firstPage = await pdf.getPage(1);
                    const initialViewport = firstPage.getViewport({ scale: 1 });
                    const scale = Math.min(1, maxWidth / initialViewport.width);
                    const viewport = firstPage.getViewport({ scale });

                    const canvas = document.createElement('canvas');
                    const context = canvas.getContext('2d');
                    if (!context) {
                      return { success: false, error: 'missing_canvas_context' };
                    }

                    canvas.width = Math.ceil(viewport.width);
                    canvas.height = Math.ceil(viewport.height);
                    canvas.style.width = canvas.width + 'px';
                    canvas.style.height = canvas.height + 'px';
                    document.body.replaceChildren(canvas);

                    await firstPage.render({
                      canvasContext: context,
                      viewport,
                    }).promise;

                    const dataUrl = canvas.toDataURL('image/png');

                    return {
                      success: true,
                      width: canvas.width,
                      height: canvas.height,
                      data: dataUrl.split(',')[1],
                    };
                  } finally {
                    URL.revokeObjectURL(workerUrl);
                  }
                };

                try {
                  return await Promise.race([
                    renderPdf(),
                    new Promise((resolve) => {
                      setTimeout(() => {
                        resolve({ success: false, error: 'pdf_render_timeout' });
                      }, 60000);
                    }),
                  ]);
                } catch (error) {
                  return {
                    success: false,
                    error: error instanceof Error ? error.message : 'pdf_render_failed',
                  };
                }
              }, {
                pdfUrl: '${pdfUrl.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}',
                maxWidth: ${THUMBNAIL_MAX_WIDTH},
                workerScript: ${JSON.stringify(pdfJsWorkerBundle)},
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

        const result = JSON.parse(response.result as string) as {
          success: boolean;
          data?: string;
          error?: string;
        };

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

        if (!result.data) {
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

        const base64Screenshot = result.data;
        const buffer = Buffer.from(base64Screenshot, "base64");
        const imageArrayBuffer = buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength
        );

        const thumbnailBlob = new Blob([imageArrayBuffer], {
          type: "image/png",
        });
        const thumbnailId = await storeBlobInR2(ctx, thumbnailBlob, {
          kind: "thumbnails",
          fileName: `${args.cardId}.png`,
          type: "image/png",
          userId: card.userId,
        });

        // Update the card with the thumbnail
        await ctx.runMutation(
          internal.workflows.steps.renderables.mutations.updateCardThumbnail,
          {
            cardId: args.cardId,
            thumbnailId,
          }
        );

        console.log(
          `[renderables/pdf] Successfully generated thumbnail for card ${args.cardId}`
        );

        return {
          success: true,
          generated: true,
          thumbnailId,
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
