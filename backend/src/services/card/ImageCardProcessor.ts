import { CardProcessor } from './CardProcessor.js';
import type { ProcessedCardData, ProcessingContext } from './CardProcessor.js';
import { createFileUploadService } from '../file/FileUploadFactory.js';
import type { FileUploadService } from '../file/FileUploadService.js';

export class ImageCardProcessor extends CardProcessor {
  private fileUploadService: FileUploadService;

  constructor() {
    super();
    this.fileUploadService = createFileUploadService();
  }

  async process(context: ProcessingContext): Promise<ProcessedCardData> {
    if (!context.file) {
      // Handle URL-based image
      const mediaUrl = context.inputData['media_url'];
      if (!mediaUrl) {
        throw new Error('Image card requires either a file upload or media_url');
      }

      return {
        data: {
          media_url: mediaUrl
        },
        metaInfo: context.inputData['metaInfo'] || {}
      };
    }

    // Handle file upload
    const uploadResult = await this.fileUploadService.uploadFile(context.file, {
      maxSize: 10 * 1024 * 1024, // 10MB for images
      allowedTypes: [
        'image/jpeg', 'image/png', 'image/gif', 'image/webp',
        'image/svg+xml', 'image/bmp', 'image/tiff'
      ],
      generateUrl: (path) => `/api/uploads/${path}`
    });

    return {
      data: {
        media_url: uploadResult.url,
        original_filename: uploadResult.originalName,
        width: uploadResult.width,
        height: uploadResult.height
      },
      metaInfo: {
        file_size: uploadResult.size,
        mime_type: uploadResult.mimeType,
        uploaded_at: new Date().toISOString()
      }
    };
  }
}