import { z } from "zod";
import { cardTypes } from "../../schema";
import {
  normalizeLinkCategory,
  type LinkCategory,
} from "../../../shared/linkCategories";

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

const linkCategoryValueSchema = z
  .string()
  .transform((value, ctx): LinkCategory => {
    const normalized = normalizeLinkCategory(value);
    if (!normalized) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid category value: ${value}`,
      });
      return z.NEVER;
    }
    return normalized;
  });

export const linkCategoryClassificationSchema = z.object({
  category: linkCategoryValueSchema.describe("Link category label"),
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
