import { z } from 'zod';

// File upload validation schema
export const fileUploadSchema = z.object({
  type: z.enum(['audio', 'video', 'image']),
  data: z
    .object({
      transcription: z.string().optional(),
      alt_text: z.string().optional(),
      title: z.string().optional(),
      description: z.string().optional(),
    })
    .optional(),
  metaInfo: z.record(z.unknown()).optional(),
});

// Form data validation for file uploads
export const createCardWithFileSchema = z.object({
  type: z.enum(['audio', 'video', 'image', 'text', 'url']),
  data: z
    .string()
    .optional()
    .transform((str) => {
      if (!str) return {};
      try {
        return JSON.parse(str);
      } catch {
        return {};
      }
    }),
  metaInfo: z
    .string()
    .optional()
    .transform((str) => {
      if (!str) return {};
      try {
        return JSON.parse(str);
      } catch {
        return {};
      }
    }),
});

export type FileUploadRequest = z.infer<typeof fileUploadSchema>;
export type CreateCardWithFileRequest = z.infer<
  typeof createCardWithFileSchema
>;
