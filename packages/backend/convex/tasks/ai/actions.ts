import { v } from "convex/values";
import { action, internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { Id } from "../../_generated/dataModel";
import { generateTextMetadata, generateImageMetadata, generateLinkMetadata } from "./metadata_generators";
import { generateTranscript } from "./transcript";

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
      const card = await ctx.runQuery(internal.tasks.ai.queries.getCardForAI, { cardId });

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
            await ctx.scheduler.runAfter(30000, internal.tasks.ai.actions.generateAiMetadata, {
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

        case "quote": {
          // Generate AI metadata for quotes using the quote content
          if (card.content?.trim()) {
            const result = await generateTextMetadata(card.content);
            aiTags = result.aiTags;
            aiSummary = result.aiSummary;
          }
          break;
        }

        case "palette": {
          // Generate AI metadata for color palettes
          let contentToAnalyze = card.content || "";
          
          // Add color information if available
          if (card.colors && card.colors.length > 0) {
            const colorInfo = card.colors.map(color => {
              const parts = [color.hex];
              if (color.name) parts.push(color.name);
              return parts.join(" ");
            }).join(", ");
            contentToAnalyze = `Colors: ${colorInfo}\n${contentToAnalyze}`;
          }

          if (contentToAnalyze.trim()) {
            const result = await generateTextMetadata(contentToAnalyze);
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
        await ctx.runMutation(internal.tasks.ai.mutations.updateCardAI, {
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

        await ctx.scheduler.runAfter(delay, internal.tasks.ai.actions.generateAiMetadata, {
          cardId,
          retryCount: retryCount + 1,
        });
      } else {
        console.error(`Max retries exceeded for card ${cardId}`);
      }
    }
  },
});

// Cron job helper to find cards missing AI metadata
export const enqueueMissingAiGeneration = internalAction({
  args: {},
  handler: async (ctx): Promise<{ enqueuedCount: number; error?: string }> => {
    try {
      const cardsToProcess: { cardId: Id<"cards"> }[] = await ctx.runQuery(
        internal.tasks.ai.queries.findCardsMissingAi,
        {}
      );

      console.log(`Found ${cardsToProcess.length} cards missing AI metadata`);

      // Schedule AI generation for each card
      for (const { cardId } of cardsToProcess) {
        await ctx.scheduler.runAfter(0, internal.tasks.ai.actions.generateAiMetadata, {
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
      internal.tasks.ai.queries.getCardForVerification,
      {
        cardId,
        userId: user.subject,
      }
    );

    if (!verification) {
      throw new Error("Card not found or access denied");
    }

    // Schedule AI generation
    await ctx.scheduler.runAfter(0, internal.tasks.ai.actions.generateAiMetadata, { cardId });

    return { success: true };
  },
});