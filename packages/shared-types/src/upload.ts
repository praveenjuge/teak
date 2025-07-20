import { z } from 'zod';
import { cardTypeEnum } from './cards';

// File upload validation schemas
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
  type: cardTypeEnum,
  data: z
    .string()
    .optional()
    .transform((str) => {
      if (!str) {
        return {};
      }
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
      if (!str) {
        return {};
      }
      try {
        return JSON.parse(str);
      } catch {
        return {};
      }
    }),
});

// File upload service interfaces
export interface UploadedFile {
  filename: string;
  originalName: string;
  path: string;
  size: number;
  mimeType: string;
  url: string;
  width?: number; // Image width in pixels
  height?: number; // Image height in pixels
}

export interface UploadOptions {
  maxSize: number;
  allowedTypes?: string[];
  generateUrl: (path: string) => string;
  userId: string;
}

// Type exports
export type FileUploadRequest = z.infer<typeof fileUploadSchema>;
export type CreateCardWithFileRequest = z.infer<
  typeof createCardWithFileSchema
>;
