import type { ProcessedCardData, ProcessingContext } from './CardProcessor.js';
import { CardProcessor } from './CardProcessor.js';

export class TextCardProcessor extends CardProcessor {
  async process(context: ProcessingContext): Promise<ProcessedCardData> {
    const content = context.inputData['content'];

    if (!content || typeof content !== 'string') {
      throw new Error('Text card requires content field');
    }

    // Check if the text is exactly one URL
    const singleUrl = this.extractSingleUrl(content);
    if (singleUrl) {
      // Convert to URL card type by throwing a special error
      throw new Error(`AUTO_CONVERT_TO_URL:${singleUrl}`);
    }

    return {
      data: {
        content: content.trim(),
      },
      metaInfo: {
        character_count: content.length,
        word_count: this.countWords(content),
        created_at: new Date().toISOString(),
      },
    };
  }

  private countWords(text: string): number {
    return text
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0).length;
  }
}
