import { generateObject } from "ai";
import { aiMetadataSchema } from "./schemas";
import {
  TEXT_METADATA_MODEL,
  LINK_METADATA_MODEL,
  IMAGE_METADATA_MODEL,
  SYSTEM_PROMPTS,
} from "../../ai/models";

/**
 * Generate AI metadata for text content
 * Uses prompt caching-enabled model (openai/gpt-oss-20b)
 */
export const generateTextMetadata = async (content: string, title?: string) => {
  // Dynamic content placed last for optimal caching
  const fullContent = title
    ? `Title: ${title}\n\nContent: ${content}`
    : content;

  try {
    const result = await generateObject({
      model: TEXT_METADATA_MODEL,
      // Static system prompt - will be cached across requests
      system: SYSTEM_PROMPTS.textAnalysis,
      // Dynamic content last for cache optimization
      prompt: `Analyze this content and generate tags and summary:\n\n${fullContent}`,
      schema: aiMetadataSchema,
    });

    return {
      aiTags: result.object.tags,
      aiSummary: result.object.summary,
    };
  } catch (error) {
    console.error("Error generating text metadata:", error);
    throw error;
  }
};

/**
 * Generate AI metadata for image content (using vision)
 * Note: Vision model (llama-4-scout) does NOT currently support prompt caching
 */
export const generateImageMetadata = async (
  imageUrl: string,
  title?: string,
) => {
  try {
    const result = await generateObject({
      model: IMAGE_METADATA_MODEL,
      // Static system prompt - structured for potential future caching support
      system: SYSTEM_PROMPTS.imageAnalysis,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              // Dynamic text content
              text: title
                ? `Image title: ${title}\n\nAnalyze this image and generate tags and summary:`
                : "Analyze this image and generate tags and summary:",
            },
            {
              type: "image",
              // Dynamic image content
              image: imageUrl,
            },
          ],
        },
      ],
      schema: aiMetadataSchema,
    });

    return {
      aiTags: result.object.tags,
      aiSummary: result.object.summary,
    };
  } catch (error) {
    console.error("Error generating image metadata:", error);
    throw error;
  }
};

/**
 * Generate AI metadata for link content
 * Uses prompt caching-enabled model (openai/gpt-oss-20b)
 */
export const generateLinkMetadata = async (content: string, url?: string) => {
  try {
    const result = await generateObject({
      model: LINK_METADATA_MODEL,
      // Static system prompt - will be cached across requests
      system: SYSTEM_PROMPTS.linkAnalysis,
      // Dynamic content last for cache optimization
      prompt: `Analyze this web page content and generate optimized tags and summary for knowledge management:

${content}

${url ? `\nURL: ${url}` : ""}

Generate tags and summary that will help the user rediscover and understand the value of this content.`,
      schema: aiMetadataSchema,
    });

    return {
      aiTags: result.object.tags,
      aiSummary: result.object.summary,
    };
  } catch (error) {
    console.error("Error generating link metadata:", error);
    throw error;
  }
};
