import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import {
  parseColorString,
  type Color,
} from "@teak/convex/shared/utils/colorUtils";
import { paletteExtractionSchema } from "./schemas";

const MAX_PALETTE_COLORS = 12;

export const extractPaletteWithAi = async (
  card: any,
  text: string,
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
      error,
    );
    return [];
  }
};
