import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, mutation } from "./_generated/server";
import { internal } from "./_generated/api";

// Microlink.io API response types
interface MicrolinkImage {
  url: string;
  type?: string;
  size?: number;
  height?: number;
  width?: number;
}

interface MicrolinkLogo {
  url: string;
  type?: string;
  size?: number;
  height?: number;
  width?: number;
}

interface MicrolinkAudio {
  url: string;
  type?: string;
  duration?: number;
}

interface MicrolinkVideo {
  url: string;
  type?: string;
  duration?: number;
  width?: number;
  height?: number;
}

interface MicrolinkData {
  title?: string;
  description?: string;
  lang?: string;
  author?: string;
  publisher?: string;
  image?: MicrolinkImage;
  logo?: MicrolinkLogo;
  date?: string;
  url?: string;
  audio?: MicrolinkAudio[];
  video?: MicrolinkVideo[];
}

interface MicrolinkResponse {
  status: string;
  data?: MicrolinkData;
}


// Validate and normalize URL
const normalizeUrl = (url: string): string => {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return `https://${url}`;
  }
  return url;
};


// Internal query to get card for metadata extraction
export const getCardForMetadata = internalQuery({
  args: { cardId: v.id("cards") },
  handler: async (ctx, { cardId }) => {
    return await ctx.db.get(cardId);
  },
});

// Internal mutation to update card with link metadata
export const updateCardMetadata = internalMutation({
  args: {
    cardId: v.id("cards"),
    microlinkData: v.optional(v.any()),
    status: v.union(v.literal("completed"), v.literal("failed")),
  },
  handler: async (ctx, { cardId, microlinkData, status }) => {
    const existingCard = await ctx.db.get(cardId);
    if (!existingCard) {
      console.error(`Card ${cardId} not found for metadata update`);
      return;
    }

    // Merge new metadata with existing metadata
    const updatedMetadata = {
      ...existingCard.metadata,
      microlinkData,
    };

    // Prepare update fields
    const updateFields: any = {
      metadata: updatedMetadata,
      metadataStatus: status,
      updatedAt: Date.now(),
    };

    // Extract title and description for search indexes
    const title = microlinkData?.data?.title;
    const description = microlinkData?.data?.description;

    if (title) {
      updateFields.metadataTitle = title;
    }
    if (description) {
      updateFields.metadataDescription = description;
    }

    return await ctx.db.patch(cardId, updateFields);
  },
});

export const extractLinkMetadata = internalAction({
  args: {
    cardId: v.id("cards"),
    retryCount: v.optional(v.number()),
  },
  handler: async (ctx, { cardId, retryCount = 0 }) => {
    let cardUrl = "";
    try {
      // Get card data
      const card = await ctx.runQuery(internal.linkMetadata.getCardForMetadata, { cardId });

      if (!card || card.type !== "link" || !card.url) {
        console.error(`[linkMetadata] Card ${cardId} is not a valid link card`);
        await ctx.runMutation(internal.linkMetadata.updateCardMetadata, {
          cardId,
          microlinkData: undefined,
          status: "failed",
        });
        return;
      }

      cardUrl = card.url;
      console.log(`[linkMetadata] Extracting metadata for card ${cardId}, URL: ${cardUrl} (attempt ${retryCount + 1})`);

      // Normalize URL
      const normalizedUrl = normalizeUrl(cardUrl);

      // Call Microlink.io API
      const microlinkApiUrl = `https://api.microlink.io/?url=${encodeURIComponent(normalizedUrl)}`;
      console.log(`[linkMetadata] Calling Microlink API: ${microlinkApiUrl}`);

      // Fetch metadata with timeout (increased to 20 seconds for better reliability)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        console.log(`[linkMetadata] API call timeout after 20s for ${normalizedUrl}`);
        controller.abort();
      }, 20000); // 20 second timeout

      console.log(`[linkMetadata] Starting fetch for ${normalizedUrl}`);
      const fetchStartTime = Date.now();

      const response = await fetch(microlinkApiUrl, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'TeakApp/1.0 (+https://teakvault.com)',
        },
      });

      clearTimeout(timeoutId);
      const fetchDuration = Date.now() - fetchStartTime;
      console.log(`[linkMetadata] Fetch completed in ${fetchDuration}ms for ${normalizedUrl}`);

      if (!response.ok) {
        console.error(`[linkMetadata] Microlink API error ${response.status} ${response.statusText} for ${normalizedUrl}`);
        console.error(`[linkMetadata] Response headers:`, Object.fromEntries(response.headers.entries()));

        // Try to get error response body
        try {
          const errorText = await response.text();
          console.error(`[linkMetadata] Error response body:`, errorText);
        } catch (e) {
          console.error(`[linkMetadata] Could not read error response body:`, e);
        }

        await ctx.runMutation(internal.linkMetadata.updateCardMetadata, {
          cardId,
          microlinkData: {
            status: "error",
            data: {
              title: cardUrl, // Fallback to URL
            },
          },
          status: "failed",
        });
        return;
      }

      console.log(`[linkMetadata] Response status: ${response.status} ${response.statusText}`);
      console.log(`[linkMetadata] Response headers:`, Object.fromEntries(response.headers.entries()));

      // Parse JSON response
      console.log(`[linkMetadata] Parsing JSON response for ${normalizedUrl}`);
      const microlinkResponse: MicrolinkResponse = await response.json();
      console.log(`[linkMetadata] Parsed response status: ${microlinkResponse.status}`);

      if (microlinkResponse.status !== "success") {
        console.warn(`[linkMetadata] Microlink extraction failed for ${normalizedUrl}:`, microlinkResponse);
        await ctx.runMutation(internal.linkMetadata.updateCardMetadata, {
          cardId,
          microlinkData: {
            status: microlinkResponse.status,
            data: {
              title: cardUrl, // Fallback to URL
            },
          },
          status: "failed",
        });
        return;
      }

      // Update card with extracted metadata
      await ctx.runMutation(internal.linkMetadata.updateCardMetadata, {
        cardId,
        microlinkData: microlinkResponse,
        status: "completed",
      });

      console.log(`Metadata extracted for card ${cardId} (${normalizedUrl}):`, {
        title: !!microlinkResponse.data?.title,
        description: !!microlinkResponse.data?.description,
        image: !!microlinkResponse.data?.image?.url,
        logo: !!microlinkResponse.data?.logo?.url,
        publisher: !!microlinkResponse.data?.publisher,
        author: !!microlinkResponse.data?.author,
        date: !!microlinkResponse.data?.date,
      });

    } catch (error) {
      console.error(`[linkMetadata] Error extracting metadata for card ${cardId}:`, error);
      console.error(`[linkMetadata] Error type:`, (error as any)?.constructor?.name);
      console.error(`[linkMetadata] Error message:`, (error as any)?.message);
      console.error(`[linkMetadata] Error stack:`, (error as any)?.stack);

      // Specific handling for different error types
      let errorStatus = "error";
      let shouldRetry = false;

      if ((error as any)?.name === "AbortError") {
        console.error(`[linkMetadata] Request was aborted (timeout) for ${cardUrl}`);
        errorStatus = "timeout";
        shouldRetry = retryCount < 2; // Retry up to 2 times for timeouts
      } else if ((error as any)?.name === "TypeError" && (error as any)?.message?.includes("fetch")) {
        console.error(`[linkMetadata] Network error for ${cardUrl}`);
        errorStatus = "network_error";
        shouldRetry = retryCount < 1; // Retry once for network errors
      }

      // Retry if appropriate
      if (shouldRetry) {
        console.log(`[linkMetadata] Retrying metadata extraction for card ${cardId} in 5 seconds (retry ${retryCount + 1})`);
        await ctx.scheduler.runAfter(5000, internal.linkMetadata.extractLinkMetadata, {
          cardId,
          retryCount: retryCount + 1,
        });
        return;
      }

      // Update card with failure status and fallback metadata (no more retries)
      console.error(`[linkMetadata] Failed to extract metadata after ${retryCount + 1} attempts for card ${cardId}`);
      await ctx.runMutation(internal.linkMetadata.updateCardMetadata, {
        cardId,
        microlinkData: {
          status: errorStatus,
          data: {
            title: undefined, // Let it fallback to URL in the UI
          },
        },
        status: "failed",
      });
    }
  },
});

