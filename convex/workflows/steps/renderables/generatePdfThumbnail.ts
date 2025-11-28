"use node";

import Kernel from "@onkernel/sdk";
import { internal } from "../../../_generated/api";
import { internalAction } from "../../../_generated/server";
import { v } from "convex/values";

// Maximum thumbnail width - height will scale proportionally to maintain document aspect ratio
const THUMBNAIL_MAX_WIDTH = 400;

/**
 * Generate a thumbnail image from the first page of a PDF document.
 * Uses @onkernel/sdk with Playwright to render the PDF in a headless browser.
 */
export const generatePdfThumbnail = internalAction({
  args: {
    cardId: v.id("cards"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      // Get the card to verify it exists and is a PDF document
      const card = await ctx.runQuery(internal.card.getCard.getCardInternal, {
        cardId: args.cardId,
      });

      if (!card) {
        console.log(`[renderables/pdf] Card ${args.cardId} not found`);
        return null;
      }

      // Only generate thumbnails for PDF documents
      if (card.type !== "document" || !card.fileId) {
        console.log(
          `[renderables/pdf] Skipping card ${args.cardId} - not a document or no fileId`
        );
        return null;
      }

      // Check if it's a PDF based on mimeType
      const mimeType = card.fileMetadata?.mimeType;
      if (mimeType !== "application/pdf") {
        console.log(
          `[renderables/pdf] Skipping card ${args.cardId} - not a PDF (mimeType: ${mimeType})`
        );
        return null;
      }

      // Skip if thumbnail already exists
      if (card.thumbnailId) {
        console.log(
          `[renderables/pdf] Skipping card ${args.cardId} - thumbnail already exists`
        );
        return null;
      }

      // Get the PDF URL from storage
      const pdfUrl = await ctx.storage.getUrl(card.fileId);
      if (!pdfUrl) {
        console.log(
          `[renderables/pdf] Could not get URL for fileId ${card.fileId}`
        );
        return null;
      }

      console.log(`[renderables/pdf] Processing PDF for card ${args.cardId}`);

      // Use Kernel with Playwright to render the PDF
      const kernel = new Kernel();
      let kernelBrowser: { session_id: string } | undefined;

      try {
        // Create a browser session
        kernelBrowser = await kernel.browsers.create({
          stealth: true,
        });

        // Execute Playwright code to render PDF and capture screenshot
        // Use Mozilla's PDF.js viewer which is hosted and works reliably
        const response = await kernel.browsers.playwright.execute(
          kernelBrowser.session_id,
          {
            code: `
              // Set viewport size
              await page.setViewportSize({ width: ${THUMBNAIL_MAX_WIDTH + 50}, height: 700 });
              
              // Use Mozilla's hosted PDF.js viewer
              const viewerUrl = 'https://mozilla.github.io/pdf.js/web/viewer.html?file=' + encodeURIComponent('${pdfUrl.replace(/'/g, "\\'")}');
              
              await page.goto(viewerUrl, { 
                waitUntil: 'networkidle',
                timeout: 60000 
              });
              
              // Wait for PDF to render - look for the canvas element
              await page.waitForSelector('#viewer .page canvas', { timeout: 30000 });
              
              // Wait a bit more for rendering to complete
              await new Promise(r => setTimeout(r, 2000));
              
              // Inject CSS to remove shadows and gray areas
              await page.addStyleTag({
                content: \`
                  body, html { 
                    margin: 0 !important;
                    padding: 0 !important;
                    box-shadow: none !important;
                    border: none !important;
                  }
                  .page { 
                    box-shadow: none !important; 
                    border: none !important;
                    margin: 0 !important;
                  }
                  .page canvas {
                    box-shadow: none !important;
                    border: none !important;
                  }
                \`
              });
              
              // Get the canvas element directly for a clean screenshot
              const canvas = await page.$('#viewer .page canvas');
              if (!canvas) {
                throw new Error('Could not find PDF canvas element');
              }
              
              const screenshot = await canvas.screenshot({ type: 'png' });
              return screenshot.toString('base64');
            `,
            timeout_sec: 120,
          }
        );

        if (!response.success || !response.result) {
          console.error(
            `[renderables/pdf] Kernel Playwright execution failed for card ${args.cardId}:`,
            response.error
          );
          return null;
        }

        const base64Screenshot = response.result as string;
        const buffer = Buffer.from(base64Screenshot, "base64");
        const imageArrayBuffer = buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength
        );

        const thumbnailBlob = new Blob([imageArrayBuffer], {
          type: "image/png",
        });
        const thumbnailId = await ctx.storage.store(thumbnailBlob);

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
      } finally {
        // Clean up the browser session
        if (kernelBrowser?.session_id) {
          try {
            await kernel.browsers.deleteByID(kernelBrowser.session_id);
          } catch (cleanupError) {
            console.warn(
              `[renderables/pdf] Failed to cleanup browser session:`,
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
      return null;
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
      await ctx.runAction(
        internal.workflows.steps.renderables.generatePdfThumbnail
          .generatePdfThumbnail,
        {
          cardId: args.cardId,
        }
      );
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
