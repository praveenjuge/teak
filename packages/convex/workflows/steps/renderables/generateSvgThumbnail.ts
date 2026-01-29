"use node";

import Kernel from "@onkernel/sdk";
import { internal } from "../../../_generated/api";
import { internalAction } from "../../../_generated/server";
import { v } from "convex/values";

// Maximum thumbnail dimensions - matches image thumbnail settings
const THUMBNAIL_MAX_WIDTH = 500;
const THUMBNAIL_MAX_HEIGHT = 500;

/**
 * Fetch SVG content from storage and convert to data URL
 * Convex storage URLs may not be accessible from external browsers,
 * so we fetch the content server-side and pass it as a data URL.
 */
async function fetchSvgAsDataUrl(svgStorageUrl: string): Promise<string> {
  const response = await fetch(svgStorageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch SVG: ${response.statusText}`);
  }

  const svgText = await response.text();

  // Ensure it's actually an SVG
  if (!svgText.trim().startsWith("<svg") && !svgText.trim().startsWith("<?xml")) {
    throw new Error("Fetched content is not a valid SVG");
  }

  // Convert to base64 data URL
  const base64 = Buffer.from(svgText, "utf-8").toString("base64");
  return `data:image/svg+xml;base64,${base64}`;
}

/**
 * Extract dimensions from SVG content
 * Returns undefined if dimensions can't be determined
 */
function extractSvgDimensions(svgContent: string): { width: number; height: number } | undefined {
  // Try to extract width and height from SVG attributes
  const widthMatch = svgContent.match(/width=["']([^"']+)["']/i);
  const heightMatch = svgContent.match(/height=["']([^"']+)["']/i);
  const viewBoxMatch = svgContent.match(/viewBox=["']([^"']+)["']/i);

  let width: number | undefined;
  let height: number | undefined;

  if (widthMatch && heightMatch) {
    width = parseFloat(widthMatch[1]);
    height = parseFloat(heightMatch[1]);
  } else if (viewBoxMatch) {
    const viewBoxParts = viewBoxMatch[1].split(/\s+/);
    if (viewBoxParts.length === 4) {
      width = parseFloat(viewBoxParts[2]);
      height = parseFloat(viewBoxParts[3]);
    }
  }

  // Ensure dimensions are valid numbers
  if (width && width > 0 && height && height > 0) {
    return { width, height };
  }

  return undefined;
}

/**
 * Generate a thumbnail image from an SVG file.
 * Uses @onkernel/sdk with Playwright to render SVG to canvas and
 * convert to PNG - SVG files need to be rasterized for thumbnails.
 */
export const generateSvgThumbnail = internalAction({
  args: {
    cardId: v.id("cards"),
  },
  returns: v.object({
    success: v.boolean(),
    generated: v.boolean(),
    thumbnailId: v.optional(v.id("_storage")),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    try {
      // Get the card to verify it exists and is an image
      const card = await ctx.runQuery(internal.card.getCard.getCardInternal, {
        cardId: args.cardId,
      });

      if (!card) {
        console.log(`[renderables/svg] Card ${args.cardId} not found`);
        return {
          success: false,
          generated: false,
          error: "card_not_found",
        };
      }

      // Only generate thumbnails for image cards with SVG files
      const isSvg =
        card.fileMetadata?.mimeType === "image/svg+xml" ||
        card.fileMetadata?.fileName?.endsWith(".svg") ||
        card.fileMetadata?.fileName?.endsWith(".SVG");

      if (card.type !== "image" || !card.fileId || !isSvg) {
        console.log(
          `[renderables/svg] Skipping card ${args.cardId} - not an SVG image`
        );
        return {
          success: true,
          generated: false,
        };
      }

      // Skip if thumbnail already exists
      if (card.thumbnailId) {
        console.log(
          `[renderables/svg] Skipping card ${args.cardId} - thumbnail already exists`
        );
        return {
          success: true,
          generated: false,
          thumbnailId: card.thumbnailId,
        };
      }

      // Get the SVG URL from storage
      const svgUrl = await ctx.storage.getUrl(card.fileId);
      if (!svgUrl) {
        console.log(
          `[renderables/svg] Could not get URL for fileId ${card.fileId}`
        );
        return {
          success: false,
          generated: false,
          error: "missing_storage_url",
        };
      }

      console.log(
        `[renderables/svg] Processing SVG for card ${args.cardId}`
      );

      // Fetch SVG content and convert to data URL (bypasses CORS issues)
      let svgDataUrl: string;
      let originalWidth: number | undefined;
      let originalHeight: number | undefined;

      try {
        svgDataUrl = await fetchSvgAsDataUrl(svgUrl);

        // Try to extract dimensions from SVG for aspect ratio
        const response = await fetch(svgUrl);
        const svgContent = await response.text();
        const dimensions = extractSvgDimensions(svgContent);
        if (dimensions) {
          originalWidth = dimensions.width;
          originalHeight = dimensions.height;
        }
      } catch (fetchError) {
        console.error(
          `[renderables/svg] Failed to fetch SVG content for card ${args.cardId}:`,
          fetchError
        );
        return {
          success: false,
          generated: false,
          error: fetchError instanceof Error ? fetchError.message : "fetch_failed",
        };
      }

      // Use Kernel with Playwright to render SVG to canvas
      const kernel = new Kernel();
      let kernelBrowser: { session_id: string } | undefined;

      try {
        // Create a browser session
        kernelBrowser = await kernel.browsers.create({
          stealth: true,
        });

        // Escape the data URL for use in the code string
        const escapedDataUrl = svgDataUrl.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

        // Execute Playwright code to render SVG and convert to PNG
        const response = await kernel.browsers.playwright.execute(
          kernelBrowser.session_id,
          {
            code: `
              await page.setViewportSize({ width: 800, height: 600 });

              // Navigate to a blank page first
              await page.goto('about:blank');

              // Execute SVG rendering entirely within page.evaluate
              const result = await page.evaluate(async ({ svgDataUrl, maxWidth, maxHeight }) => {
                return new Promise((resolve) => {
                  const img = new Image();

                  let resolved = false;
                  const timeout = setTimeout(() => {
                    if (!resolved) {
                      resolved = true;
                      resolve({ success: false, error: 'SVG loading timeout after 30s' });
                    }
                  }, 30000);

                  img.onerror = (e) => {
                    if (!resolved) {
                      resolved = true;
                      clearTimeout(timeout);
                      resolve({ success: false, error: 'SVG load error: ' + (e.message || 'Unknown error') });
                    }
                  };

                  img.onload = () => {
                    if (resolved) return;
                    resolved = true;
                    clearTimeout(timeout);

                    try {
                      const canvas = document.createElement('canvas');
                      const ctx = canvas.getContext('2d');

                      if (!ctx) {
                        resolve({ success: false, error: 'Could not get canvas context' });
                        return;
                      }

                      // Get original SVG dimensions
                      const originalWidth = img.naturalWidth || img.width || 800;
                      const originalHeight = img.naturalHeight || img.height || 600;

                      // Calculate thumbnail dimensions preserving aspect ratio
                      const aspectRatio = originalWidth / originalHeight;

                      let targetWidth, targetHeight;
                      if (aspectRatio > 1) {
                        // Landscape: width is the limiting factor
                        targetWidth = Math.min(originalWidth, maxWidth);
                        targetHeight = Math.round(targetWidth / aspectRatio);
                      } else {
                        // Portrait or square: height is the limiting factor
                        targetHeight = Math.min(originalHeight, maxHeight);
                        targetWidth = Math.round(targetHeight * aspectRatio);
                      }

                      // Ensure we don't exceed max dimensions
                      if (targetWidth > maxWidth) {
                        targetWidth = maxWidth;
                        targetHeight = Math.round(targetWidth / aspectRatio);
                      }
                      if (targetHeight > maxHeight) {
                        targetHeight = maxHeight;
                        targetWidth = Math.round(targetHeight * aspectRatio);
                      }

                      // Set minimum dimensions to avoid tiny thumbnails
                      if (targetWidth < 1) targetWidth = 100;
                      if (targetHeight < 1) targetHeight = 100;

                      canvas.width = targetWidth;
                      canvas.height = targetHeight;

                      // Draw the SVG to canvas
                      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

                      // Convert to PNG (PNG is better for SVGs with sharp edges/text)
                      const dataUrl = canvas.toDataURL('image/png');
                      const base64 = dataUrl.split(',')[1];

                      resolve({
                        success: true,
                        data: base64,
                        width: targetWidth,
                        height: targetHeight,
                        originalWidth: originalWidth,
                        originalHeight: originalHeight,
                        mimeType: 'image/png',
                      });
                    } catch (err) {
                      resolve({ success: false, error: err?.message || 'Canvas error' });
                    }
                  };

                  img.src = svgDataUrl;
                });
              }, {
                svgDataUrl: '${escapedDataUrl}',
                maxWidth: ${THUMBNAIL_MAX_WIDTH},
                maxHeight: ${THUMBNAIL_MAX_HEIGHT}
              });

              return JSON.stringify(result);
            `,
            timeout_sec: 60,
          }
        );

        if (!response.success || !response.result) {
          console.error(
            `[renderables/svg] Kernel Playwright execution failed for card ${args.cardId}:`,
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
            `[renderables/svg] SVG thumbnail generation failed for card ${args.cardId}:`,
            result.error
          );
          return {
            success: false,
            generated: false,
            error: result.error || "thumbnail_generation_failed",
          };
        }

        const base64Thumbnail = result.data as string;
        const buffer = Buffer.from(base64Thumbnail, "base64");
        const imageArrayBuffer = buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength
        );

        const thumbnailBlob = new Blob([imageArrayBuffer], {
          type: "image/png",
        });
        const thumbnailId = await ctx.storage.store(thumbnailBlob);

        // Use extracted dimensions or fall back to rendered dimensions
        const finalOriginalWidth = originalWidth ?? (result.originalWidth as number | undefined);
        const finalOriginalHeight = originalHeight ?? (result.originalHeight as number | undefined);

        // Update the card with the thumbnail and original dimensions
        await ctx.runMutation(
          internal.workflows.steps.renderables.mutations.updateCardThumbnail,
          {
            cardId: args.cardId,
            thumbnailId,
            ...(finalOriginalWidth !== undefined && { originalWidth: finalOriginalWidth }),
            ...(finalOriginalHeight !== undefined && { originalHeight: finalOriginalHeight }),
          }
        );

        console.log(
          `[renderables/svg] Successfully generated thumbnail for card ${args.cardId} (${result.width}x${result.height})`
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
              `[renderables/svg] Failed to cleanup browser session:`,
              cleanupError
            );
          }
        }
      }
    } catch (error) {
      console.error(
        `[renderables/svg] Failed to generate SVG thumbnail for card ${args.cardId}:`,
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
 * Manual trigger for SVG thumbnail generation (useful for testing)
 */
export const manualTriggerSvgThumbnail = internalAction({
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
        internal.workflows.steps.renderables.generateSvgThumbnail.generateSvgThumbnail,
        {
          cardId: args.cardId,
        }
      );
      if (!result.success) {
        return {
          success: false,
          message: `Failed to generate SVG thumbnail: ${result.error || "Unknown error"}`,
        };
      }
      return {
        success: true,
        message: `SVG thumbnail generation initiated for card ${args.cardId}`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to generate SVG thumbnail: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  },
});
