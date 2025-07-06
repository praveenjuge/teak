import { db } from '../../db/index.js';
import { cards } from '../../db/schema.js';
import { AudioCardProcessor } from './AudioCardProcessor.js';
import { VideoCardProcessor } from './VideoCardProcessor.js';
import { TextCardProcessor } from './TextCardProcessor.js';
import { UrlCardProcessor } from './UrlCardProcessor.js';
import { ImageCardProcessor } from './ImageCardProcessor.js';
import { CardProcessor, ProcessingContext } from './CardProcessor.js';

export type CardType = 'audio' | 'text' | 'url' | 'image' | 'video';

export interface CreateCardRequest {
  type: CardType;
  data: Record<string, any>;
  metaInfo?: Record<string, any>;
  file?: File;
}

export interface CreateCardResponse {
  id: number;
  type: CardType;
  data: Record<string, any>;
  metaInfo: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  userId: string;
}

export class CardService {
  private processors: Map<CardType, CardProcessor>;

  constructor() {
    this.processors = new Map([
      ['audio', new AudioCardProcessor()],
      ['video', new VideoCardProcessor()],
      ['text', new TextCardProcessor()],
      ['url', new UrlCardProcessor()],
      ['image', new ImageCardProcessor()]
    ]);
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
      inputData: request.data
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
            ...processed.metaInfo
          },
          userId
        })
        .returning();

      return newCard;

    } catch (error) {
      // Handle auto-conversion from text to URL
      if (error instanceof Error && error.message.startsWith('AUTO_CONVERT_TO_URL:')) {
        const url = error.message.split('AUTO_CONVERT_TO_URL:')[1];
        
        // Recursively create URL card
        return this.createCard({
          type: 'url',
          data: { url },
          metaInfo: request.metaInfo
        }, userId);
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