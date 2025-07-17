import type {
  CardType,
  CreateCardRequest,
  CreateCardResponse,
  ProcessingContext,
} from '@teak/shared-types';
import { db } from '../../db/index.js';
import { cards } from '../../db/schema.js';
import { AudioCardProcessor } from './AudioCardProcessor.js';
import type { CardProcessor } from './CardProcessor.js';
import { ImageCardProcessor } from './ImageCardProcessor.js';
import { TextCardProcessor } from './TextCardProcessor.js';
import { UrlCardProcessor } from './UrlCardProcessor.js';
import { VideoCardProcessor } from './VideoCardProcessor.js';

export class CardService {
  private processors: Map<CardType, CardProcessor>;

  constructor() {
    this.processors = new Map<CardType, CardProcessor>([
      ['audio', new AudioCardProcessor()],
      ['video', new VideoCardProcessor()],
      ['text', new TextCardProcessor()],
      ['url', new UrlCardProcessor()],
      ['image', new ImageCardProcessor()],
    ] as const);
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
        data: newCard.data as Record<string, any>,
        metaInfo: newCard.metaInfo as Record<string, any>,
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

  async validateCardType(type: string): Promise<boolean> {
    return this.processors.has(type as CardType);
  }

  getSupportedTypes(): CardType[] {
    return Array.from(this.processors.keys());
  }
}
