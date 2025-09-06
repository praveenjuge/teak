import { z } from "zod";

// AI generation result schema
export const aiMetadataSchema = z.object({
  tags: z.array(z.string()).describe("5-6 relevant tags for the content, each tag should be 1-2 words maximum"),
  summary: z.string().describe("Brief, helpful summary of the content"),
});