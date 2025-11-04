import { v } from "convex/values";
import { action } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { parseColorString, type Color } from "@teak/convex/shared/utils/colorUtils";
import { paletteExtractionSchema } from "./schemas";

const MAX_PALETTE_COLORS = 12;

export const extractPaletteWithAi = async (
  card: any,
  text: string
): Promise<Color[]> => {
  if (!text) {
    return [];
  }

  try {
    const result = await generateObject({
      model: openai("gpt-5-nano"),
      system:
        "You extract colour palettes from user notes or CSS snippets. Only return colours that are explicitly present and prefer hex codes.",
      prompt: `Extract up to ${MAX_PALETTE_COLORS} unique colours (with their hex codes) from the following palette card. Preserve any provided names:\n\n${text}`,
      schema: paletteExtractionSchema,
    });

    const colors = result.object.colors ?? [];
    return colors
      .map((entry) => {
        const parsed = parseColorString(entry.hex ?? "");
        if (!parsed) {
          return null;
        }
        if (entry.name) {
          parsed.name = entry.name.trim();
        }
        return parsed;
      })
      .filter((color): color is Color => !!color);
  } catch (error) {
    console.error(
      `[ai] Palette extraction failed for ${card?._id ?? "unknown card"}`,
      error
    );
    return [];
  }
};

export const manuallyGenerateAI = action({
  args: { cardId: v.id("cards") },
  handler: async (ctx, { cardId }) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("Authentication required");
    }

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

    await ctx.scheduler.runAfter(
      0,
      (internal as any)["workflows/manager"].startCardProcessingWorkflow,
      { cardId }
    );

    return { success: true };
  },
});
