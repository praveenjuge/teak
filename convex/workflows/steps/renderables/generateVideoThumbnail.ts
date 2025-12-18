"use node";

import Kernel from "@onkernel/sdk";
import { internal } from "../../../_generated/api";
import { internalAction } from "../../../_generated/server";
import { v } from "convex/values";

// Maximum thumbnail dimensions - matches image thumbnail settings
const THUMBNAIL_MAX_WIDTH = 400;
const THUMBNAIL_MAX_HEIGHT = 400;

/**
 * Generate a thumbnail image from a video file.
 * Uses @onkernel/sdk with Playwright to extract a video frame using the
 * native HTML5 video element and canvas API - no external libraries needed.
 */
export const generateVideoThumbnail = internalAction({
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
      // Get the card to verify it exists and is a video
      const card = await ctx.runQuery(internal.card.getCard.getCardInternal, {
        cardId: args.cardId,
      });

      if (!card) {
        console.log(`[renderables/video] Card ${args.cardId} not found`);
        return {
          success: false,
          generated: false,
          error: "card_not_found",
        };
      }

      // Only generate thumbnails for video cards with files
      if (card.type !== "video" || !card.fileId) {
        console.log(
          `[renderables/video] Skipping card ${args.cardId} - not a video or no fileId`
        );
        return {
          success: true,
          generated: false,
        };
      }

      // Skip if thumbnail already exists
      if (card.thumbnailId) {
        console.log(
          `[renderables/video] Skipping card ${args.cardId} - thumbnail already exists`
        );
        return {
          success: true,
          generated: false,
          thumbnailId: card.thumbnailId,
        };
      }

      // Get the video URL from storage
      const videoUrl = await ctx.storage.getUrl(card.fileId);
      if (!videoUrl) {
        console.log(
          `[renderables/video] Could not get URL for fileId ${card.fileId}`
        );
        return {
          success: false,
          generated: false,
          error: "missing_storage_url",
        };
      }

      console.log(
        `[renderables/video] Processing video for card ${args.cardId}`
      );

      // Use Kernel with Playwright to extract video frame
      const kernel = new Kernel();
      let kernelBrowser: { session_id: string } | undefined;

      try {
        // Create a browser session
        kernelBrowser = await kernel.browsers.create({
          stealth: true,
        });

        // Execute Playwright code to extract a video frame using native HTML5 APIs
        const response = await kernel.browsers.playwright.execute(
          kernelBrowser.session_id,
          {
            code: `
              await page.setViewportSize({ width: 800, height: 600 });
              
              // Navigate to a blank page first
              await page.goto('about:blank');
              
              // Execute frame extraction entirely within page.evaluate
              const result = await page.evaluate(async ({ videoUrl, maxWidth, maxHeight }) => {
                return new Promise((resolve) => {
                  const video = document.createElement('video');
                  video.crossOrigin = 'anonymous';
                  video.preload = 'metadata';
                  video.muted = true;
                  video.playsInline = true;
                  
                  let resolved = false;
                  const timeout = setTimeout(() => {
                    if (!resolved) {
                      resolved = true;
                      resolve({ success: false, error: 'Video loading timeout after 60s' });
                    }
                  }, 60000);
                  
                  video.onerror = () => {
                    if (!resolved) {
                      resolved = true;
                      clearTimeout(timeout);
                      resolve({ success: false, error: 'Video load error: ' + (video.error?.message || 'Unknown error') });
                    }
                  };
                  
                  video.onloadedmetadata = () => {
                    // Seek to 10% into the video (max 5 seconds) to avoid black frames
                    const targetTime = Math.min(video.duration * 0.1, 5);
                    video.currentTime = Math.max(0.1, targetTime); // At least 0.1s in
                  };
                  
                  video.onseeked = () => {
                    if (resolved) return;
                    resolved = true;
                    clearTimeout(timeout);
                    
                    try {
                      const canvas = document.createElement('canvas');
                      const ctx = canvas.getContext('2d');
                      
                      // Calculate thumbnail dimensions
                      const originalWidth = video.videoWidth;
                      const originalHeight = video.videoHeight;
                      
                      if (!originalWidth || !originalHeight) {
                        resolve({ success: false, error: 'Could not get video dimensions' });
                        return;
                      }
                      
                      const aspectRatio = originalWidth / originalHeight;
                      
                      let targetWidth, targetHeight;
                      if (aspectRatio > 1) {
                        targetWidth = Math.min(originalWidth, maxWidth);
                        targetHeight = Math.round(targetWidth / aspectRatio);
                      } else {
                        targetHeight = Math.min(originalHeight, maxHeight);
                        targetWidth = Math.round(targetHeight * aspectRatio);
                      }
                      
                      if (targetWidth > maxWidth) {
                        targetWidth = maxWidth;
                        targetHeight = Math.round(targetWidth / aspectRatio);
                      }
                      if (targetHeight > maxHeight) {
                        targetHeight = maxHeight;
                        targetWidth = Math.round(targetHeight * aspectRatio);
                      }
                      
                      canvas.width = targetWidth;
                      canvas.height = targetHeight;
                      ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
                      
                      // Convert to base64 - try WebP first, fall back to JPEG
                      let dataUrl = canvas.toDataURL('image/webp', 0.8);
                      let mimeType = 'image/webp';
                      
                      // Check if WebP is supported (some browsers return PNG for unsupported formats)
                      if (!dataUrl.startsWith('data:image/webp')) {
                        dataUrl = canvas.toDataURL('image/jpeg', 0.85);
                        mimeType = 'image/jpeg';
                      }
                      
                      const base64 = dataUrl.split(',')[1];
                      
                      resolve({
                        success: true,
                        data: base64,
                        width: targetWidth,
                        height: targetHeight,
                        mimeType: mimeType,
                      });
                    } catch (err) {
                      resolve({ success: false, error: err.message || 'Canvas error' });
                    }
                  };
                  
                  video.src = videoUrl;
                  video.load();
                });
              }, { 
                videoUrl: '${videoUrl.replace(/'/g, "\\'")}',
                maxWidth: ${THUMBNAIL_MAX_WIDTH},
                maxHeight: ${THUMBNAIL_MAX_HEIGHT}
              });
              
              return JSON.stringify(result);
            `,
            timeout_sec: 120,
          }
        );

        if (!response.success || !response.result) {
          console.error(
            `[renderables/video] Kernel Playwright execution failed for card ${args.cardId}:`,
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
            `[renderables/video] Video thumbnail generation failed for card ${args.cardId}:`,
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
          type: result.mimeType || "image/webp",
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
          `[renderables/video] Successfully generated thumbnail for card ${args.cardId} (${result.width}x${result.height})`
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
              `[renderables/video] Failed to cleanup browser session:`,
              cleanupError
            );
          }
        }
      }
    } catch (error) {
      console.error(
        `[renderables/video] Failed to generate video thumbnail for card ${args.cardId}:`,
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
 * Manual trigger for video thumbnail generation (useful for testing)
 */
export const manualTriggerVideoThumbnail = internalAction({
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
        internal.workflows.steps.renderables.generateVideoThumbnail
          .generateVideoThumbnail,
        {
          cardId: args.cardId,
        }
      );
      return {
        success: true,
        message: `Video thumbnail generation initiated for card ${args.cardId}`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to generate video thumbnail: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  },
});
