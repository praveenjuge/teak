import { z } from 'zod';

// AI Settings schema
export const aiSettingsSchema = z.object({
  openaiBaseUrl: z.string().url().optional(),
  openaiApiKey: z.string().optional(),
  aiTextModelName: z.string().optional(),
  aiImageTextModelName: z.string().optional(),
  embeddingModelName: z.string().optional(),
  audioTranscriptModelName: z.string().optional(),
  fileTranscriptModelName: z.string().optional(),
});

export const createAiSettingsSchema = aiSettingsSchema;
export const updateAiSettingsSchema = aiSettingsSchema.partial();

// AI enrichment data
export const aiEnrichmentSchema = z.object({
  aiSummary: z.string().optional(),
  aiTags: z.array(z.string()).optional(),
  aiTranscript: z.string().optional(),
  aiProcessedAt: z.string().optional(),
});

// Type exports
export type AiSettings = z.infer<typeof aiSettingsSchema>;
export type CreateAiSettings = z.infer<typeof createAiSettingsSchema>;
export type UpdateAiSettings = z.infer<typeof updateAiSettingsSchema>;
export type AiEnrichment = z.infer<typeof aiEnrichmentSchema>;

// AI job payload schemas
export const aiEnrichmentJobPayloadSchema = z.object({
  cardId: z.number().int().positive(),
  cardType: z.enum(['text', 'image', 'pdf', 'audio', 'url']),
  userId: z.string(),
});

export type AiEnrichmentJobPayload = z.infer<
  typeof aiEnrichmentJobPayloadSchema
>;
