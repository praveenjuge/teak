import { z } from "zod";

// AI generation result schema scoped to metadata workflow helpers
export const aiMetadataSchema = z.object({
  tags: z
    .array(z.string())
    .describe(
      "5-6 relevant tags for the content, each tag must be a single word only (no spaces, no hyphens)",
    ),
  summary: z.string().describe("Brief, helpful summary of the content"),
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
      }),
    )
    .max(12)
    .describe("Unique colours present in the palette card"),
});
