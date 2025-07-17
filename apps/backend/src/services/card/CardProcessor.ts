import type { ProcessedCardData, ProcessingContext } from '@teak/shared-types';

export abstract class CardProcessor {
  abstract process(context: ProcessingContext): Promise<ProcessedCardData>;

  protected isValidUrl(text: string): boolean {
    try {
      new URL(text);
      return true;
    } catch {
      return false;
    }
  }

  protected extractSingleUrl(text: string): string | null {
    const trimmed = text.trim();
    if (this.isValidUrl(trimmed) && !trimmed.includes(' ')) {
      return trimmed;
    }
    return null;
  }
}
