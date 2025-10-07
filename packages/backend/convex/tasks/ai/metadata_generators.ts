import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { aiMetadataSchema } from "./schemas";

// Generate AI metadata for text content
export const generateTextMetadata = async (content: string, title?: string) => {
  const fullContent = title
    ? `Title: ${title}\n\nContent: ${content}`
    : content;

  try {
    const result = await generateObject({
      model: openai("gpt-5-nano"),
      system: `You are an expert content analyzer. Generate relevant tags and a concise summary for the given content.
      
      Guidelines:
      - Tags should be 5-6 specific, relevant keywords, each 1-2 words maximum
      - Summary should be 1-2 sentences that capture the essence
      - Focus on the main topics, themes, and key information
      - Use clear, searchable language`,
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

// Generate AI metadata for image content (using vision)
export const generateImageMetadata = async (imageUrl: string, title?: string) => {
  try {
    const result = await generateObject({
      model: openai("gpt-5-nano"),
      system: `You are an expert image analyzer. Generate relevant tags and a concise summary for the given image.
      
      Guidelines:
      - Tags should be 5-6 keywords describing objects, scenes, concepts, emotions, each 1-2 words maximum
      - Summary should be 1-2 sentences describing what the image shows
      - Focus on the main visual elements and context
      - Use clear, searchable language`,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: title
                ? `Image title: ${title}\n\nAnalyze this image and generate tags and summary:`
                : "Analyze this image and generate tags and summary:",
            },
            {
              type: "image",
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

// Generate AI metadata for link content
export const generateLinkMetadata = async (content: string, url?: string) => {
  try {
    const result = await generateObject({
      model: openai("gpt-5-nano"),
      system: `You are an expert web content analyzer. Generate relevant tags and a concise summary for the given web page content.
      
      Guidelines:
      - Tags should be 5-6 keywords capturing main topics, categories, and key concepts, each 1-2 words maximum
      - Include relevant technology, industry, or topic tags where applicable
      - Summary should be 1-2 sentences capturing the essence and value of the content
      - Focus on what makes this link useful and searchable
      - Use clear, specific language that helps with discovery
      - Consider the source, author, and context when available`,
      prompt: `Analyze this web page content and generate optimized tags and summary for knowledge management:

${content}

${url ? `\nURL: ${url}` : ''}

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
