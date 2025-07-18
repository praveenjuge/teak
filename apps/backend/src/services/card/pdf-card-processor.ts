import type { ProcessedCardData, ProcessingContext } from '@teak/shared-types';
import { LocalFileUploadService } from '../file/LocalFileUploadService.js';
import { CardProcessor } from './card-processor.js';

interface PdfMetadata {
  title?: string;
  keywords?: string;
  creator?: string;
  producer?: string;
  creationDate?: Date;
  modificationDate?: Date;
  pageCount?: number;
}

export class PdfCardProcessor extends CardProcessor {
  private fileUploadService: LocalFileUploadService;

  constructor() {
    super();
    this.fileUploadService = new LocalFileUploadService();
  }

  async process(context: ProcessingContext): Promise<ProcessedCardData> {
    if (!context.file) {
      // Handle URL-based PDF
      const mediaUrl = context.inputData.media_url;
      if (!mediaUrl) {
        throw new Error(
          'PDF card requires either a file upload or media_url'
        );
      }

      return {
        data: {
          media_url: mediaUrl,
        },
        metaInfo: (context.inputData.metaInfo as Record<string, unknown>) || {},
      };
    }

    // Handle file upload
    const uploadResult = await this.fileUploadService.uploadFile(context.file, {
      maxSize: 50 * 1024 * 1024, // 50MB
      allowedTypes: [
        'application/pdf',
        'application/x-pdf',
        'application/acrobat',
        'applications/vnd.pdf',
        'text/pdf',
        'text/x-pdf',
      ],
      generateUrl: (path: string) => `/api/data/${path}`,
    });

    // Extract PDF content and metadata
    const pdfData = await this.extractPdfData(uploadResult.path);

    return {
      data: {
        media_url: uploadResult.url,
        original_filename: uploadResult.originalName,
        extracted_text: pdfData.text,
        title: pdfData.metadata.title || context.inputData.title,
        page_count: pdfData.metadata.pageCount,
        keywords: pdfData.metadata.keywords?.split(',').map(k => k.trim()).filter(k => k.length > 0),
      },
      metaInfo: {
        file_size: uploadResult.size,
        mime_type: uploadResult.mimeType,
        creator: pdfData.metadata.creator,
        producer: pdfData.metadata.producer,
        creation_date: pdfData.metadata.creationDate?.toISOString(),
        modification_date: pdfData.metadata.modificationDate?.toISOString(),
        uploaded_at: new Date().toISOString(),
      },
    };
  }

  private async extractPdfData(filePath: string): Promise<{ text: string; metadata: PdfMetadata }> {
    try {
      const fullPath = `/data/${filePath}`;
      const dataBuffer = await Bun.file(fullPath).arrayBuffer();
      
      // Use pdf-lib for PDF parsing (more compatible with Bun)
      const { PDFDocument } = await import('pdf-lib');
      const pdfDoc = await PDFDocument.load(dataBuffer);
      
      // Get basic metadata
      const pageCount = pdfDoc.getPageCount();
      const title = pdfDoc.getTitle();
      const keywords = pdfDoc.getKeywords();
      const creator = pdfDoc.getCreator();
      const producer = pdfDoc.getProducer();
      const creationDate = pdfDoc.getCreationDate();
      const modificationDate = pdfDoc.getModificationDate();

      // Note: pdf-lib doesn't extract text content, so we'll store empty text
      // This can be enhanced later with OCR or other text extraction methods
      const extractedText = '';

      // Extract metadata
      const metadata: PdfMetadata = {
        title: title || undefined,
        keywords: keywords || undefined,
        creator: creator || undefined,
        producer: producer || undefined,
        creationDate: creationDate || undefined,
        modificationDate: modificationDate || undefined,
        pageCount: pageCount || undefined,
      };

      return {
        text: extractedText,
        metadata,
      };
    } catch (error) {
      console.warn('Failed to extract PDF data:', error);
      return {
        text: '',
        metadata: {
          pageCount: 1, // Default assumption
        },
      };
    }
  }
}