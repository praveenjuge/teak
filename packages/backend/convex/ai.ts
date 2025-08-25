import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { generateObject, experimental_transcribe as transcribe } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { Id } from "./_generated/dataModel";

// AI generation result schema
const aiMetadataSchema = z.object({
  tags: z.array(z.string()).describe("Relevant tags for the content (max 8)"),
  summary: z.string().describe("Brief, helpful summary of the content"),
});

// Internal query to get card data for AI processing
export const getCardForAI = internalQuery({
  args: { cardId: v.id("cards") },
  handler: async (ctx, { cardId }) => {
    return await ctx.db.get(cardId);
  },
});

// Internal mutation to update card with AI metadata
export const updateCardAI = internalMutation({
  args: {
    cardId: v.id("cards"),
    aiTags: v.optional(v.array(v.string())),
    aiSummary: v.optional(v.string()),
    aiTranscript: v.optional(v.string()),
    aiModelMeta: v.object({
      provider: v.string(),
      model: v.string(),
      version: v.optional(v.string()),
      generatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => {
    const { cardId, ...updates } = args;
    return await ctx.db.patch(cardId, {
      ...updates,
      updatedAt: Date.now(),
    });
  },
});

// Generate AI metadata for text content
const generateTextMetadata = async (content: string, title?: string) => {
  const fullContent = title
    ? `Title: ${title}\n\nContent: ${content}`
    : content;

  try {
    const result = await generateObject({
      model: openai("gpt-5-nano"),
      system: `You are an expert content analyzer. Generate relevant tags and a concise summary for the given content.
      
      Guidelines:
      - Tags should be specific, relevant keywords (2-8 tags)
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
const generateImageMetadata = async (imageUrl: string, title?: string) => {
  try {
    const result = await generateObject({
      model: openai("gpt-5-nano"),
      system: `You are an expert image analyzer. Generate relevant tags and a concise summary for the given image.
      
      Guidelines:
      - Tags should describe objects, scenes, concepts, emotions in the image (2-8 tags)
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

// Generate AI metadata for link content (using enhanced prompts with microlink data)
const generateLinkMetadata = async (content: string, url?: string) => {
  try {
    const result = await generateObject({
      model: openai("gpt-5-nano"),
      system: `You are an expert web content analyzer. Generate relevant tags and a concise summary for the given web page content.
      
      Guidelines:
      - Tags should capture the main topics, categories, and key concepts (2-8 tags)
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

// Generate transcript for audio content
const generateTranscript = async (audioUrl: string, mimeHint?: string) => {
  try {
    console.log("Starting audio transcription for:", audioUrl);

    // Fetch the audio so we can provide a proper filename and mime type
    const response = await fetch(audioUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch audio: ${response.status} ${response.statusText}`
      );
    }

    const mimeType =
      mimeHint || response.headers.get("content-type") || "audio/webm";
    console.log("Transcription mimeType/ext hint:", mimeType);

    // Infer a reasonable file extension for OpenAI based on the mime type
    const ext =
      mimeType.includes("ogg") || mimeType.includes("oga")
        ? "ogg"
        : mimeType.includes("mp3") ||
          mimeType.includes("mpeg") ||
          mimeType.includes("mpga")
          ? "mp3"
          : mimeType.includes("wav")
            ? "wav"
            : mimeType.includes("m4a")
              ? "m4a"
              : mimeType.includes("webm")
                ? "webm"
                : "mp3";

    const arrayBuffer = await response.arrayBuffer();

    // First try direct OpenAI API with explicit filename to avoid SDK dropping filename
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not set");
    }

    const formData = new FormData();
    formData.append("model", "gpt-4o-mini-transcribe");
    const blob = new Blob([arrayBuffer], { type: mimeType });
    formData.append("file", blob, `audio.${ext}`);

    const openaiResponse = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
      }
    );

    if (openaiResponse.ok) {
      const data = (await openaiResponse.json()) as { text?: string };
      console.log("Audio transcription completed successfully (direct)");
      return data.text || null;
    }

    // If direct upload fails, fallback to AI SDK transcribe
    const errText = await openaiResponse.text();
    console.warn(
      `Direct OpenAI transcription failed, falling back to SDK: ${openaiResponse.status} ${openaiResponse.statusText} - ${errText}`
    );

    const file = new File([arrayBuffer], `audio.${ext}`, { type: mimeType });
    const { text } = await transcribe({
      model: openai.transcription("gpt-4o-mini-transcribe"),
      audio: file as any,
    });
    console.log("Audio transcription completed successfully (sdk)");
    return text;
  } catch (error) {
    console.error("Error generating transcript:", error);
    return null;
  }
};

// Main AI metadata generation action
export const generateAiMetadata = internalAction({
  args: {
    cardId: v.id("cards"),
    retryCount: v.optional(v.number()),
  },
  handler: async (ctx, { cardId, retryCount = 0 }) => {
    const MAX_RETRIES = 3;
    const RETRY_DELAY = [5000, 30000, 120000]; // 5s, 30s, 2m

    try {
      // Get card data
      const card = await ctx.runQuery(internal.ai.getCardForAI, { cardId });

      if (!card) {
        console.error(`Card ${cardId} not found`);
        return;
      }

      console.log(`Generating AI metadata for card ${cardId} (${card.type})`);

      let aiTags: string[] = [];
      let aiSummary: string = "";
      let aiTranscript: string | undefined = undefined;

      // Process based on card type
      switch (card.type) {
        case "text": {
          const result = await generateTextMetadata(card.content);
          aiTags = result.aiTags;
          aiSummary = result.aiSummary;
          break;
        }

        case "image": {
          if (card.fileId) {
            const imageUrl = await ctx.storage.getUrl(card.fileId);
            if (imageUrl) {
              const result = await generateImageMetadata(imageUrl);
              aiTags = result.aiTags;
              aiSummary = result.aiSummary;
            }
          }
          break;
        }

        case "audio": {
          if (card.fileId) {
            const audioUrl = await ctx.storage.getUrl(card.fileId);
            if (audioUrl) {
              // Generate transcript first
              const transcriptResult = await generateTranscript(
                audioUrl,
                card.fileMetadata?.mimeType
              );
              if (transcriptResult) {
                aiTranscript = transcriptResult;
                // Generate metadata from transcript
                const result = await generateTextMetadata(
                  transcriptResult
                );
                aiTags = result.aiTags;
                aiSummary = result.aiSummary;
              }
            }
          }
          break;
        }

        case "link": {
          // Check if microlink data is available - if not, retry later
          if (!card.metadata?.microlinkData && card.metadataStatus === "pending") {
            console.log(`Microlink data not yet available for card ${cardId}, retrying in 30 seconds`);
            await ctx.scheduler.runAfter(30000, internal.ai.generateAiMetadata, {
              cardId,
              retryCount,
            });
            return;
          }

          // Build rich content from microlink data
          const microlinkData = card.metadata?.microlinkData?.data;
          const contentParts: string[] = [];

          // Primary content
          if (microlinkData?.title) {
            contentParts.push(`Title: ${microlinkData.title}`);
          }
          if (microlinkData?.description) {
            contentParts.push(`Description: ${microlinkData.description}`);
          }

          // Contextual information
          if (microlinkData?.author) {
            contentParts.push(`Author: ${microlinkData.author}`);
          }
          if (microlinkData?.publisher) {
            contentParts.push(`Publisher: ${microlinkData.publisher}`);
          }
          if (microlinkData?.date) {
            contentParts.push(`Published: ${microlinkData.date}`);
          }

          // Fallback to URL content if no microlink data
          if (contentParts.length === 0 && card.content) {
            contentParts.push(`URL: ${card.content}`);
          }

          const contentToAnalyze = contentParts.join("\n");

          if (contentToAnalyze.trim()) {
            // Use enhanced prompt for links
            const result = await generateLinkMetadata(contentToAnalyze, card.url || card.content);
            aiTags = result.aiTags;
            aiSummary = result.aiSummary;
          }
          break;
        }

        case "document": {
          // For documents, try to extract text or use filename/content
          let contentToAnalyze = card.content;
          if (card.fileMetadata?.fileName) {
            contentToAnalyze = `${card.fileMetadata.fileName}\n${contentToAnalyze}`;
          }

          if (contentToAnalyze.trim()) {
            const result = await generateTextMetadata(
              contentToAnalyze
            );
            aiTags = result.aiTags;
            aiSummary = result.aiSummary;
          }
          break;
        }

        default:
          console.log(
            `AI generation not implemented for card type: ${card.type}`
          );
          return;
      }

      // Update card with AI metadata
      if (aiTags.length > 0 || aiSummary || aiTranscript) {
        await ctx.runMutation(internal.ai.updateCardAI, {
          cardId,
          aiTags: aiTags.length > 0 ? aiTags : undefined,
          aiSummary: aiSummary || undefined,
          aiTranscript,
          aiModelMeta: {
            provider: "openai",
            model: card.type === "image" ? "gpt-5-nano" : "gpt-5-nano",
            version: "2024-08-06",
            generatedAt: Date.now(),
          },
        });

        console.log(`AI metadata generated for card ${cardId}:`, {
          tags: aiTags.length,
          summary: !!aiSummary,
          transcript: !!aiTranscript,
        });
      }
    } catch (error) {
      console.error(`Error generating AI metadata for card ${cardId}:`, error);

      // Implement retry logic with exponential backoff
      if (retryCount < MAX_RETRIES) {
        const delay = RETRY_DELAY[retryCount] || 120000;
        console.log(
          `Scheduling retry ${retryCount + 1}/${MAX_RETRIES} in ${delay}ms`
        );

        await ctx.scheduler.runAfter(delay, internal.ai.generateAiMetadata, {
          cardId,
          retryCount: retryCount + 1,
        });
      } else {
        console.error(`Max retries exceeded for card ${cardId}`);
      }
    }
  },
});

// Internal query to find cards missing AI metadata
export const findCardsMissingAi = internalQuery({
  args: {},
  handler: async (ctx) => {
    // Find cards that don't have AI metadata (created more than 5 minutes ago to avoid race conditions)
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;

    const cards = await ctx.db
      .query("cards")
      .filter((q) =>
        q.and(
          q.neq(q.field("isDeleted"), true),
          q.lt(q.field("createdAt"), fiveMinutesAgo),
          q.eq(q.field("aiModelMeta"), undefined)
        )
      )
      .take(50); // Process in batches

    return cards.map((card) => ({ cardId: card._id }));
  },
});

// Cron job helper to find cards missing AI metadata
export const enqueueMissingAiGeneration = internalAction({
  args: {},
  handler: async (ctx): Promise<{ enqueuedCount: number; error?: string }> => {
    try {
      const cardsToProcess: { cardId: Id<"cards"> }[] = await ctx.runQuery(
        internal.ai.findCardsMissingAi,
        {}
      );

      console.log(`Found ${cardsToProcess.length} cards missing AI metadata`);

      // Schedule AI generation for each card
      for (const { cardId } of cardsToProcess) {
        await ctx.scheduler.runAfter(0, internal.ai.generateAiMetadata, {
          cardId,
        });
      }

      return { enqueuedCount: cardsToProcess.length };
    } catch (error) {
      console.error("Error in AI metadata backfill:", error);
      return { enqueuedCount: 0, error: String(error) };
    }
  },
});

// Internal query to get card for verification
export const getCardForVerification = internalQuery({
  args: { cardId: v.id("cards"), userId: v.string() },
  handler: async (ctx, { cardId, userId }) => {
    const card = await ctx.db.get(cardId);
    if (!card || card.userId !== userId) {
      return null;
    }
    return { exists: true };
  },
});

// Public action to manually trigger AI generation (admin use)
export const manuallyGenerateAI = action({
  args: { cardId: v.id("cards") },
  handler: async (ctx, { cardId }) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("Authentication required");
    }

    // Verify user owns the card
    const verification = await ctx.runQuery(
      internal.ai.getCardForVerification,
      {
        cardId,
        userId: user.subject,
      }
    );

    if (!verification) {
      throw new Error("Card not found or access denied");
    }

    // Schedule AI generation
    await ctx.scheduler.runAfter(0, internal.ai.generateAiMetadata, { cardId });

    return { success: true };
  },
});
