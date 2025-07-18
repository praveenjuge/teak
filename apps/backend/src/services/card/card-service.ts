import type {
  CardType,
  CreateCardRequest,
  CreateCardResponse,
  ProcessingContext,
} from '@teak/shared-types';
import { db } from '../../db/index.js';
import { cards } from '../../db/schema.js';
import { AudioCardProcessor } from './audio-card-processor.js';
import type { CardProcessor } from './card-processor.js';
import { ImageCardProcessor } from './image-card-processor.js';
import { PdfCardProcessor } from './pdf-card-processor.js';
import { TextCardProcessor } from './text-card-processor.js';
import { UrlCardProcessor } from './UrlCardProcessor.js';
import { VideoCardProcessor } from './VideoCardProcessor.js';

export class CardService {
  private processors: Map<CardType, CardProcessor>;

  constructor() {
    this.processors = new Map<CardType, CardProcessor>();
    this.processors.set('audio', new AudioCardProcessor());
    this.processors.set('video', new VideoCardProcessor());
    this.processors.set('text', new TextCardProcessor());
    this.processors.set('url', new UrlCardProcessor());
    this.processors.set('image', new ImageCardProcessor());
    this.processors.set('pdf', new PdfCardProcessor());
  }

  async createCard(
    request: CreateCardRequest,
    userId: string
  ): Promise<CreateCardResponse> {
    const processor = this.processors.get(request.type);
    if (!processor) {
      throw new Error(`Unsupported card type: ${request.type}`);
    }

    const context: ProcessingContext = {
      userId,
      file: request.file,
      inputData: request.data,
    };

    try {
      // Process the card based on its type
      const processed = await processor.process(context);

      // Insert into database
      const [newCard] = await db
        .insert(cards)
        .values({
          type: request.type,
          data: processed.data,
          metaInfo: {
            ...request.metaInfo,
            ...processed.metaInfo,
          },
          userId,
        })
        .returning();

      if (!newCard) {
        throw new Error('Failed to create card');
      }

      return {
        ...newCard,
        data: newCard.data as Record<string, unknown>,
        metaInfo: newCard.metaInfo as Record<string, unknown>,
      };
    } catch (error) {
      // Handle auto-conversion from text to URL
      if (
        error instanceof Error &&
        error.message.startsWith('AUTO_CONVERT_TO_URL:')
      ) {
        const url = error.message.split('AUTO_CONVERT_TO_URL:')[1];

        if (!url) {
          throw new Error('Invalid URL conversion error format');
        }

        // Recursively create URL card
        return this.createCard(
          {
            type: 'url',
            data: { url },
            metaInfo: request.metaInfo,
          },
          userId
        );
      }

      throw error;
    }
  }

  validateCardType(type: string): boolean {
    return this.processors.has(type as CardType);
  }

  getSupportedTypes(): CardType[] {
    return Array.from(this.processors.keys());
  }
}
