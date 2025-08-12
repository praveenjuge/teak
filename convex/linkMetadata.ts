import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

// Link metadata extraction result type
interface LinkMetadata {
  linkTitle?: string;
  linkDescription?: string;
  linkImage?: string;
  linkFavicon?: string;
}

// Extract meta tag content
const extractMetaContent = (html: string, selector: string): string | null => {
  // Simple regex-based extraction for meta tags
  const regex = new RegExp(`<meta[^>]*${selector}[^>]*content=["']([^"']+)["'][^>]*>`, 'i');
  const match = html.match(regex);
  return match ? match[1] : null;
};

// Extract title tag content
const extractTitle = (html: string): string | null => {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return titleMatch ? titleMatch[1].trim() : null;
};

// Extract favicon URL
const extractFavicon = (html: string, baseUrl: string): string | null => {
  // Look for various favicon formats
  const iconRegex = /<link[^>]*rel=["'](?:icon|shortcut icon|apple-touch-icon)["'][^>]*href=["']([^"']+)["'][^>]*>/i;
  const match = html.match(iconRegex);

  if (match) {
    const href = match[1];
    // Convert relative URLs to absolute
    if (href.startsWith('http')) {
      return href;
    } else if (href.startsWith('//')) {
      return `https:${href}`;
    } else if (href.startsWith('/')) {
      return `${baseUrl}${href}`;
    } else {
      return `${baseUrl}/${href}`;
    }
  }

  // Fallback to default favicon
  return `${baseUrl}/favicon.ico`;
};

// Normalize URL to get base URL
const getBaseUrl = (url: string): string => {
  try {
    const urlObj = new URL(url);
    return `${urlObj.protocol}//${urlObj.host}`;
  } catch {
    return '';
  }
};

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
    metadata: v.object({
      linkTitle: v.optional(v.string()),
      linkDescription: v.optional(v.string()),
      linkImage: v.optional(v.string()),
      linkFavicon: v.optional(v.string()),
    }),
    status: v.union(v.literal("completed"), v.literal("failed")),
  },
  handler: async (ctx, { cardId, metadata, status }) => {
    const existingCard = await ctx.db.get(cardId);
    if (!existingCard) {
      console.error(`Card ${cardId} not found for metadata update`);
      return;
    }

    // Merge new metadata with existing metadata
    const updatedMetadata = {
      ...existingCard.metadata,
      ...metadata,
    };

    // Also populate the flattened metadata fields for search indexing
    const updateFields: any = {
      metadata: updatedMetadata,
      metadataStatus: status,
      updatedAt: Date.now(),
    };

    // Extract title and description for search indexes
    if (metadata.linkTitle) {
      updateFields.metadataTitle = metadata.linkTitle;
    }
    if (metadata.linkDescription) {
      updateFields.metadataDescription = metadata.linkDescription;
    }

    return await ctx.db.patch(cardId, updateFields);
  },
});

export const extractLinkMetadata = internalAction({
  args: {
    cardId: v.id("cards"),
  },
  handler: async (ctx, { cardId }) => {
    try {
      // Get card data
      const card = await ctx.runQuery(internal.linkMetadata.getCardForMetadata, { cardId });

      if (!card || card.type !== "link" || !card.url) {
        console.error(`Card ${cardId} is not a valid link card`);
        await ctx.runMutation(internal.linkMetadata.updateCardMetadata, {
          cardId,
          metadata: {},
          status: "failed",
        });
        return;
      }

      console.log(`Extracting metadata for card ${cardId}, URL: ${card.url}`);

      // Normalize URL
      const normalizedUrl = normalizeUrl(card.url);
      const baseUrl = getBaseUrl(normalizedUrl);

      // Fetch HTML content with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      const response = await fetch(normalizedUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; TeakBot/1.0; +https://teakvault.com)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Cache-Control': 'no-cache',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn(`HTTP error ${response.status} for ${normalizedUrl}`);
        await ctx.runMutation(internal.linkMetadata.updateCardMetadata, {
          cardId,
          metadata: { linkTitle: card.url },
          status: "failed",
        });
        return;
      }

      // Check content type
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html')) {
        console.warn(`Non-HTML content type: ${contentType}`);
        await ctx.runMutation(internal.linkMetadata.updateCardMetadata, {
          cardId,
          metadata: { linkTitle: card.url },
          status: "failed",
        });
        return;
      }

      // Get HTML content (limit to 1MB to prevent memory issues)
      const html = await response.text();
      if (html.length > 1024 * 1024) {
        console.warn(`HTML content too large: ${html.length} bytes`);
        await ctx.runMutation(internal.linkMetadata.updateCardMetadata, {
          cardId,
          metadata: { linkTitle: card.url },
          status: "failed",
        });
        return;
      }

      // Extract metadata
      const metadata: LinkMetadata = {};

      // Extract title (prefer og:title, fallback to title tag)
      metadata.linkTitle =
        extractMetaContent(html, 'property=["\']*og:title["\']') ||
        extractMetaContent(html, 'name=["\']*twitter:title["\']') ||
        extractTitle(html) ||
        card.url;

      // Extract description
      const description =
        extractMetaContent(html, 'property=["\']*og:description["\']') ||
        extractMetaContent(html, 'name=["\']*twitter:description["\']') ||
        extractMetaContent(html, 'name=["\']*description["\']');
      metadata.linkDescription = description || undefined;

      // Extract image
      const imageUrl =
        extractMetaContent(html, 'property=["\']*og:image["\']') ||
        extractMetaContent(html, 'name=["\']*twitter:image["\']');

      if (imageUrl) {
        // Convert relative URLs to absolute
        if (imageUrl.startsWith('http')) {
          metadata.linkImage = imageUrl;
        } else if (imageUrl.startsWith('//')) {
          metadata.linkImage = `https:${imageUrl}`;
        } else if (imageUrl.startsWith('/')) {
          metadata.linkImage = `${baseUrl}${imageUrl}`;
        } else {
          metadata.linkImage = `${baseUrl}/${imageUrl}`;
        }
      }

      // Extract favicon
      const favicon = extractFavicon(html, baseUrl);
      metadata.linkFavicon = favicon || undefined;

      // Update card with extracted metadata
      await ctx.runMutation(internal.linkMetadata.updateCardMetadata, {
        cardId,
        metadata,
        status: "completed",
      });

      console.log(`Metadata extracted for card ${cardId} (${normalizedUrl}):`, {
        title: !!metadata.linkTitle,
        description: !!metadata.linkDescription,
        image: !!metadata.linkImage,
        favicon: !!metadata.linkFavicon,
      });

    } catch (error) {
      console.error(`Error extracting metadata for card ${cardId}:`, error);

      // Update card with failure status and fallback metadata
      await ctx.runMutation(internal.linkMetadata.updateCardMetadata, {
        cardId,
        metadata: {
          linkTitle: undefined, // Let it fallback to URL in the UI
        },
        status: "failed",
      });
    }
  },
});