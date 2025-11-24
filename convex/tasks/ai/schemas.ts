import { z } from "zod";
import { cardTypes } from "../../schema";

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

export const linkCategoryClassificationSchema = z.object({
  category: z
    .string()
    .describe(
      "Link category label. Prefer canonical slugs such as 'book', 'movie', 'software', or exact labels from the provided category list.",
    ),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("Confidence score between 0 and 1")
    .optional(),
  providerHint: z
    .string()
    .describe("Optional hint about the content source, e.g. 'github', 'imdb'")
    .optional(),
  tags: z
    .array(z.string())
    .max(10)
    .describe(
      "Optional supporting keywords, each must be a single word (no spaces, no hyphens)",
    )
    .optional(),
});
