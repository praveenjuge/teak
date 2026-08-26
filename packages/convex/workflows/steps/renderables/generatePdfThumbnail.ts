"use node";

import Kernel from "@onkernel/sdk";
import { v } from "convex/values";
import { internal } from "../../../_generated/api";
import { internalAction } from "../../../_generated/server";
import {
  buildSignedWorkerUploadUrl,
  callFilesWorkerJson,
  type FilesWorkerHeadObjectResult,
} from "../../../storage/filesWorkerClient";
import { buildR2ObjectKey, resolveObjectUrl } from "../../../storage/r2";

// Bound both dimensions so hostile page aspect ratios cannot create an
// unbounded browser canvas. The page still scales proportionally.
const THUMBNAIL_MAX_WIDTH = 1600;
const THUMBNAIL_MAX_HEIGHT = 1600;

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

      // Mint a short-lived signed destination URL so the Kernel VM uploads
      // the generated thumbnail directly to the Files Worker; the bytes never
      // pass back through Convex.
      const thumbnailKey = buildR2ObjectKey({
        userId: card.userId,
        cardId: args.cardId,
        role: "thumbnail",
      });
      const uploadUrl = (
        await buildSignedWorkerUploadUrl({
          contentType: "image/png",
          key: thumbnailKey,
        })
      ).url;

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

              // Fetch the pdf.js library through the Node-side request context
              // (which ignores browser CORS) and evaluate it in-page. External
              // script injection via page.addScriptTag does not execute in this
              // headless runtime, so pdfjsLib would remain undefined.
              const libResponse = await context.request.get(${JSON.stringify(PDFJS_LIB_URL)});
              const libSource = libResponse.ok() ? await libResponse.text() : '';
              const workerResponse = await context.request.get(${JSON.stringify(PDFJS_WORKER_URL)});
              const workerSource = workerResponse.ok() ? await workerResponse.text() : '';

              await page.goto('about:blank');

              const result = await page.evaluate(async ({ pdfBase64, libSource, workerSource, maxWidth, maxHeight }) => {
                try {
                  if (!libSource) {
                    return { success: false, error: 'pdf.js failed to load' };
                  }
                  (0, eval)(libSource);
                  const pdfjsLib = window['pdfjsLib'];
                  if (!pdfjsLib) {
                    return { success: false, error: 'pdf.js failed to load' };
                  }
                  if (workerSource) {
                    const workerBlob = new Blob([workerSource], { type: 'text/javascript' });
                    pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(workerBlob);
                  } else {
                    pdfjsLib.GlobalWorkerOptions.workerSrc = 'data:application/javascript,';
                  }

                  // Decode base64 into a byte array.
                  const binary = atob(pdfBase64);
                  const bytes = new Uint8Array(binary.length);
                  for (let i = 0; i < binary.length; i++) {
                    bytes[i] = binary.charCodeAt(i);
                  }

                  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
                  const pdfPage = await pdf.getPage(1);

                  // Fit the first page inside the bounded thumbnail canvas.
                  const baseViewport = pdfPage.getViewport({ scale: 1 });
                  if (
                    !Number.isFinite(baseViewport.width) ||
                    !Number.isFinite(baseViewport.height) ||
                    baseViewport.width <= 0 ||
                    baseViewport.height <= 0
                  ) {
                    return { success: false, error: 'Invalid PDF page dimensions' };
                  }
                  const scale = Math.min(
                    3,
                    maxWidth / baseViewport.width,
                    maxHeight / baseViewport.height
                  );
                  const viewport = pdfPage.getViewport({ scale });
                  const targetWidth = Math.max(1, Math.min(maxWidth, Math.ceil(viewport.width)));
                  const targetHeight = Math.max(1, Math.min(maxHeight, Math.ceil(viewport.height)));

                  const canvas = document.createElement('canvas');
                  const ctx = canvas.getContext('2d');
                  if (!ctx) {
                    return { success: false, error: 'Could not get canvas context' };
                  }
                  canvas.width = targetWidth;
                  canvas.height = targetHeight;

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
                libSource,
                workerSource,
                maxWidth: ${THUMBNAIL_MAX_WIDTH},
                maxHeight: ${THUMBNAIL_MAX_HEIGHT}
              });

              if (!result.success) {
                return JSON.stringify(result);
              }
              // Upload the rendered PNG straight to the Files Worker from
              // inside the VM so the bytes never return through Convex.
              const thumbnailPng = Buffer.from(result.data, 'base64');
              const uploadResponse = await context.request.put(${JSON.stringify(uploadUrl)}, { data: thumbnailPng });
              if (!uploadResponse.ok()) {
                return JSON.stringify({ error: 'upload_failed_' + uploadResponse.status(), success: false });
              }
              return JSON.stringify({
                etag: uploadResponse.headers()['etag'] || null,
                height: result.height,
                success: true,
                width: result.width,
              });
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

        // Verify the committed object before Convex records it.
        const head = await callFilesWorkerJson<FilesWorkerHeadObjectResult>({
          op: "head-object",
          params: { key: thumbnailKey },
        });
        if (
          head.kind !== "ok" ||
          !head.data.exists ||
          !head.data.size ||
          head.data.contentType !== "image/png"
        ) {
          console.warn(
            `[renderables/pdf] Uploaded thumbnail failed verification for card ${args.cardId}`
          );
          return {
            success: false,
            generated: false,
            error: "thumbnail_upload_verification_failed",
          };
        }

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
