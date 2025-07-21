// Base AI service interface and types

export interface AiEnrichmentResult {
  summary?: string;
  tags?: string[];
  transcript?: string;
}

export interface AiServiceConfig {
  baseUrl?: string;
  apiKey?: string;
  textModelName?: string;
  imageTextModelName?: string;
  embeddingModelName?: string;
  audioTranscriptModelName?: string;
  fileTranscriptModelName?: string;
}

export abstract class AiService {
  protected config: AiServiceConfig;

  constructor(config: AiServiceConfig) {
    this.config = config;
  }

  // Check if the service is properly configured
  abstract isConfigured(): boolean;

  // Generate AI tags for content
  abstract generateTags(
    content: string,
    contentType: string
  ): Promise<string[]>;

  // Generate a two-line summary
  abstract generateSummary(
    content: string,
    contentType: string
  ): Promise<string>;

  // Transcribe audio content
  abstract transcribeAudio(
    audioBuffer: Buffer,
    mimeType: string
  ): Promise<string>;

  // Extract and transcribe text from documents (PDFs, etc.)
  abstract transcribeDocument(content: string): Promise<string>;

  // Extract text content from PDF file
  abstract extractPdfContent(pdfBuffer: Buffer): Promise<string>;

  // Analyze image content
  abstract analyzeImage(
    imageBuffer: Buffer,
    mimeType: string
  ): Promise<{
    description: string;
    tags: string[];
  }>;

  // Extract content from URL (for URL card enrichment)
  abstract extractUrlContent(url: string): Promise<{
    content: string;
    description: string;
    tags: string[];
  }>;
}
