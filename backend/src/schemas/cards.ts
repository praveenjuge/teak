import { z } from 'zod';

// Base card schema
export const cardTypeEnum = z.enum(['audio', 'text', 'url', 'image', 'video']);

// Card data schemas for different types
export const audioDataSchema = z.object({
  transcription: z.string().optional(), // Made optional since it can be empty for file uploads
  media_url: z.string().optional(), // Made optional for file uploads
  duration: z.number().positive().optional(),
  title: z.string().optional(),
  original_filename: z.string().optional(), // For uploaded files
});

export const textDataSchema = z.object({
  content: z.string().min(1, 'Content is required'),
  title: z.string().optional(),
});

export const urlDataSchema = z.object({
  url: z.string().url('Must be a valid URL'),
  title: z.string().optional(),
  description: z.string().optional(),
  image: z.string().optional(), // For OG image
});

export const imageDataSchema = z.object({
  media_url: z.string().optional(), // Made optional for file uploads
  alt_text: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  original_filename: z.string().optional(), // For uploaded files
  width: z.number().positive().optional(), // Image width in pixels
  height: z.number().positive().optional(), // Image height in pixels
});

export const videoDataSchema = z.object({
  media_url: z.string().optional(), // Made optional for file uploads
  transcription: z.string().optional(),
  subtitles: z.string().optional(),
  duration: z.number().positive().optional(),
  title: z.string().optional(),
  original_filename: z.string().optional(), // For uploaded files
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
  .catchall(z.unknown()); // Allow additional fields

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
]);

// Create card schema
export const createCardSchema = z.object({
  type: cardTypeEnum,
  data: z.record(z.unknown()), // Will be validated by cardDataSchema
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
  q: z.string().optional(), // Search query
  type: cardTypeEnum.optional(), // Filter by card type
  limit: z.coerce.number().int().min(1).optional(), // Remove max limit and make optional
  offset: z.coerce.number().int().min(0).default(0),
  sort: z.enum(['created_at', 'updated_at', 'type']).default('created_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

// Card ID parameter
export const cardIdSchema = z.object({
  id: z.coerce.number().int().positive(),
});

// Response schemas
export const cardResponseSchema = z.object({
  id: z.number(),
  type: cardTypeEnum,
  data: z.record(z.unknown()),
  metaInfo: z.record(z.unknown()),
  createdAt: z.date(),
  updatedAt: z.date(),
  deletedAt: z.date().nullable(),
  userId: z.string(),
});

export const cardsListResponseSchema = z.object({
  cards: z.array(cardResponseSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

// Type exports
export type CardType = z.infer<typeof cardTypeEnum>;
export type AudioData = z.infer<typeof audioDataSchema>;
export type TextData = z.infer<typeof textDataSchema>;
export type UrlData = z.infer<typeof urlDataSchema>;
export type ImageData = z.infer<typeof imageDataSchema>;
export type VideoData = z.infer<typeof videoDataSchema>;
export type MetaInfo = z.infer<typeof metaInfoSchema>;
export type CreateCard = z.infer<typeof createCardSchema>;
export type UpdateCard = z.infer<typeof updateCardSchema>;
export type SearchCardsQuery = z.infer<typeof searchCardsSchema>;
export type CardResponse = z.infer<typeof cardResponseSchema>;
export type CardsListResponse = z.infer<typeof cardsListResponseSchema>;
