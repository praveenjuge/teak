import { z } from 'zod';

// Card type enum
export const cardTypeEnum = z.enum([
  'audio',
  'text',
  'url',
  'image',
  'video',
  'pdf',
]);
export type CardType = z.infer<typeof cardTypeEnum>;

// Card data schemas for different types
export const audioDataSchema = z.object({
  transcription: z.string().optional(),
  media_url: z.string().optional(),
  duration: z.number().positive().optional(),
  title: z.string().optional(),
  original_filename: z.string().optional(),
});

export const textDataSchema = z.object({
  content: z.string().min(1, 'Content is required'),
  title: z.string().optional(),
});

export const urlDataSchema = z.object({
  url: z.string().url('Must be a valid URL'),
  title: z.string().optional(),
  description: z.string().optional(),
  image: z.string().optional(),
  screenshot_url: z.string().optional(),
});

export const imageDataSchema = z.object({
  media_url: z.string().optional(),
  alt_text: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  original_filename: z.string().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
});

export const videoDataSchema = z.object({
  media_url: z.string().optional(),
  transcription: z.string().optional(),
  subtitles: z.string().optional(),
  duration: z.number().positive().optional(),
  title: z.string().optional(),
  original_filename: z.string().optional(),
});

export const pdfDataSchema = z.object({
  media_url: z.string().optional(),
  extracted_text: z.string().optional(),
  title: z.string().optional(),
  original_filename: z.string().optional(),
  page_count: z.number().int().positive().optional(),
  keywords: z.array(z.string()).optional(),
});

// Meta info schema (common for all card types)
export const metaInfoSchema = z
  .object({
    language: z.string().optional(),
    playtime: z.string().optional(),
    file_size: z.number().positive().optional(),
    created_by: z.string().optional(),
    tags: z.array(z.string()).optional(),
    source: z.string().optional(),
  })
  .catchall(z.unknown());

// Combined data schema based on card type
export const cardDataSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('audio'),
    data: audioDataSchema,
  }),
  z.object({
    type: z.literal('text'),
    data: textDataSchema,
  }),
  z.object({
    type: z.literal('url'),
    data: urlDataSchema,
  }),
  z.object({
    type: z.literal('image'),
    data: imageDataSchema,
  }),
  z.object({
    type: z.literal('video'),
    data: videoDataSchema,
  }),
  z.object({
    type: z.literal('pdf'),
    data: pdfDataSchema,
  }),
]);

// Create card schema
export const createCardSchema = z.object({
  type: cardTypeEnum,
  data: z.record(z.unknown()),
  metaInfo: metaInfoSchema.optional().default({}),
});

// Update card schema
export const updateCardSchema = z.object({
  type: cardTypeEnum.optional(),
  data: z.record(z.unknown()).optional(),
  metaInfo: metaInfoSchema.optional(),
});

// Query parameters for search
export const searchCardsSchema = z.object({
  q: z.string().optional(),
  type: cardTypeEnum.optional(),
  tags: z.string().optional(), // Comma-separated tag filter
  limit: z.coerce.number().int().min(1).optional(),
  offset: z.coerce.number().int().min(0).default(0),
  sort: z.enum(['created_at', 'updated_at', 'type']).default('created_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

// Card ID parameter
export const cardIdSchema = z.object({
  id: z.coerce.number().int().positive(),
});

// Response schemas
// Database card schema (with Date objects for internal processing)
export const dbCardSchema = z.object({
  id: z.number(),
  type: cardTypeEnum,
  data: z.record(z.unknown()),
  metaInfo: z.record(z.unknown()),
  // AI enrichment fields
  aiSummary: z.string().nullable().optional(),
  aiTags: z.array(z.string()).nullable().optional(),
  aiTranscript: z.string().nullable().optional(),
  aiProcessedAt: z.date().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
  deletedAt: z.date().nullable(),
  userId: z.string(),
});

export const cardsListResponseSchema = z.object({
  cards: z.array(dbCardSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

// Type exports
export type AudioData = z.infer<typeof audioDataSchema>;
export type TextData = z.infer<typeof textDataSchema>;
export type UrlData = z.infer<typeof urlDataSchema>;
export type ImageData = z.infer<typeof imageDataSchema>;
export type VideoData = z.infer<typeof videoDataSchema>;
export type PdfData = z.infer<typeof pdfDataSchema>;
export type MetaInfo = z.infer<typeof metaInfoSchema>;
export type CreateCard = z.infer<typeof createCardSchema>;
export type UpdateCard = z.infer<typeof updateCardSchema>;
export type SearchCardsQuery = z.infer<typeof searchCardsSchema>;
export type DbCardResponse = z.infer<typeof dbCardSchema>;
export type CardsListResponse = z.infer<typeof cardsListResponseSchema>;

// Union type for card data
export type CardData =
  | AudioData
  | TextData
  | UrlData
  | ImageData
  | VideoData
  | PdfData;
