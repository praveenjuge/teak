import { z } from "zod";
import { cardTypes } from "../../schema";

// AI generation result schema
export const aiMetadataSchema = z.object({
  tags: z.array(z.string()).describe("5-6 relevant tags for the content, each tag should be 1-2 words maximum"),
  summary: z.string().describe("Brief, helpful summary of the content"),
});

export const cardClassificationSchema = z.object({
  type: z.enum(cardTypes).describe("Best matching card type"),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("Confidence score between 0 and 1"),
  reasoning: z
    .string()
    .describe("Short explanation of the classification decision")
    .optional(),
});

export const paletteExtractionSchema = z.object({
  colors: z
    .array(
      z.object({
        hex: z
          .string()
          .describe("Hex colour expressed as #RRGGBB or #RRGGBBAA"),
        name: z
          .string()
          .describe("Optional descriptive label captured from the card")
          .optional(),
      })
    )
    .max(12)
    .describe("Unique colours present in the palette card"),
});
