import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { aiSettings, cards } from '../../db/schema.js';
import type { AiEnrichmentResult, AiService } from './ai-service.js';
import { OpenAiService } from './openai-service.js';

export class AiEnrichmentService {
  async getAiServiceForUser(userId: string): Promise<AiService | null> {
    try {
      const [userSettings] = await db
        .select()
        .from(aiSettings)
        .where(eq(aiSettings.userId, userId))
        .limit(1);

      if (!(userSettings && userSettings.openaiApiKey)) {
        console.log(`❌ No AI settings or API key found for user ${userId}`);
        return null;
      }

      console.log(`🔧 AI settings loaded for user ${userId}:`, {
        hasApiKey: !!userSettings.openaiApiKey,
        baseUrl:
          userSettings.openaiBaseUrl || 'DEFAULT (https://api.openai.com/v1)',
        textModel: userSettings.aiTextModelName || 'DEFAULT',
        imageTextModel: userSettings.aiImageTextModelName || 'DEFAULT',
        embeddingModel: userSettings.embeddingModelName || 'DEFAULT',
        audioTranscriptModel:
          userSettings.audioTranscriptModelName || 'DEFAULT',
        fileTranscriptModel: userSettings.fileTranscriptModelName || 'DEFAULT',
      });

      const aiService = new OpenAiService({
        baseUrl: userSettings.openaiBaseUrl || undefined,
        apiKey: userSettings.openaiApiKey,
        textModelName: userSettings.aiTextModelName || undefined,
        imageTextModelName: userSettings.aiImageTextModelName || undefined,
        embeddingModelName: userSettings.embeddingModelName || undefined,
        audioTranscriptModelName:
          userSettings.audioTranscriptModelName || undefined,
        fileTranscriptModelName:
          userSettings.fileTranscriptModelName || undefined,
      });

      return aiService.isConfigured() ? aiService : null;
    } catch (error) {
      console.error('Failed to get AI service for user:', error);
      return null;
    }
  }

  async enrichCard(cardId: number, userId: string): Promise<void> {
    console.log(`🚀 Starting AI enrichment for card ${cardId}, user ${userId}`);

    const aiService = await this.getAiServiceForUser(userId);
    if (!aiService) {
      console.log(
        `❌ AI not configured for user ${userId}, skipping enrichment for card ${cardId}`
      );
      return;
    }

    console.log(`✅ AI service created successfully for user ${userId}`);
    console.log('🔧 AI service configured:', aiService.isConfigured());

    try {
      // Get the card data
      const [card] = await db
        .select({
          id: cards.id,
          type: cards.type,
          data: cards.data,
          metaInfo: cards.metaInfo,
          createdAt: cards.createdAt,
          updatedAt: cards.updatedAt,
          deletedAt: cards.deletedAt,
          userId: cards.userId,
          aiSummary: cards.aiSummary,
          aiTags: cards.aiTags,
          aiTranscript: cards.aiTranscript,
          aiProcessedAt: cards.aiProcessedAt,
        })
        .from(cards)
        .where(eq(cards.id, cardId))
        .limit(1);

      if (!card || card.userId !== userId) {
        console.log(
          `❌ Card ${cardId} not found or not owned by user ${userId}`
        );
        throw new Error(
          `Card ${cardId} not found or not owned by user ${userId}`
        );
      }

      console.log('📄 Card found:', {
        id: card.id,
        type: card.type,
        hasData: !!card.data,
        aiProcessedAt: card.aiProcessedAt,
        existingTags: card.aiTags,
      });

      // Skip if already processed
      if (card.aiProcessedAt) {
        console.log(
          `⏭️ Card ${cardId} already processed at ${card.aiProcessedAt}, skipping`
        );
        return;
      }

      console.log(
        `🎯 Starting AI enrichment for card ${cardId} of type ${card.type}`
      );

      let enrichmentResult: Partial<AiEnrichmentResult> = {};

      switch (card.type) {
        case 'text':
          console.log(`📝 Processing text card ${cardId}`);
          enrichmentResult = await this.enrichTextCard(aiService, card);
          break;
        case 'image':
          console.log(`🖼️ Processing image card ${cardId}`);
          enrichmentResult = await this.enrichImageCard(aiService, card);
          break;
        case 'pdf':
          console.log(`📄 Processing PDF card ${cardId}`);
          enrichmentResult = await this.enrichPdfCard(aiService, card);
          break;
        case 'audio':
          console.log(`🔊 Processing audio card ${cardId}`);
          enrichmentResult = await this.enrichAudioCard(aiService, card);
          break;
        case 'url':
          console.log(`🔗 Processing URL card ${cardId}`);
          enrichmentResult = await this.enrichUrlCard(aiService, card);
          break;
        default:
          console.log(
            `❌ Unsupported card type for AI enrichment: ${card.type}`
          );
          return;
      }

      console.log(
        `🎉 AI enrichment completed for card ${cardId}:`,
        enrichmentResult
      );

      // Update the card with AI enrichment data
      const updateData = {
        aiSummary: enrichmentResult.summary || null,
        aiTags: enrichmentResult.tags
          ? JSON.stringify(enrichmentResult.tags)
          : null,
        aiTranscript: enrichmentResult.transcript || null,
        aiProcessedAt: new Date(),
      };

      console.log(`💾 Updating card ${cardId} with AI data:`, updateData);

      await db.update(cards).set(updateData).where(eq(cards.id, cardId));

      console.log(`✅ Successfully enriched card ${cardId}`);
    } catch (error) {
      console.error(`Failed to enrich card ${cardId}:`, error);
      throw error;
    }
  }

  private async enrichTextCard(
    aiService: AiService,
    card: any
  ): Promise<Partial<AiEnrichmentResult>> {
    const content = card.data?.content;
    if (!content) {
      return {};
    }

    const tags = await aiService.generateTags(content, 'text');

    // Text cards don't need summaries since the content is the main text
    return { tags };
  }

  private async enrichImageCard(
    aiService: AiService,
    card: any
  ): Promise<Partial<AiEnrichmentResult>> {
    const mediaUrl = card.data?.media_url;
    if (!mediaUrl) {
      return {};
    }

    try {
      let buffer: Buffer;
      let mimeType: string;

      if (mediaUrl.startsWith('http://') || mediaUrl.startsWith('https://')) {
        // External URL - fetch via HTTP
        console.log(`🖼️ Fetching external image from: ${mediaUrl}`);
        const response = await fetch(mediaUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch image: ${response.status}`);
        }
        buffer = Buffer.from(await response.arrayBuffer());
        mimeType = response.headers.get('content-type') || 'image/jpeg';
      } else {
        // Internal file - read directly from filesystem
        const filePath = mediaUrl.replace('/api/data/', '');
        const fullPath = `/data/${filePath}`;
        console.log(`🖼️ Reading image file from: ${fullPath}`);

        try {
          const file = Bun.file(fullPath);
          if (!(await file.exists())) {
            throw new Error(`Image file not found: ${fullPath}`);
          }
          buffer = Buffer.from(await file.arrayBuffer());
          mimeType = file.type || 'image/jpeg';
        } catch (fileError) {
          console.error(`Failed to read image file: ${fileError}`);
          throw new Error(`Failed to read image file: ${fullPath}`);
        }
      }

      const analysis = await aiService.analyzeImage(buffer, mimeType);

      return {
        summary: analysis.description,
        tags: analysis.tags,
      };
    } catch (error) {
      console.error('Failed to enrich image card:', error);
      return {};
    }
  }

  private async enrichPdfCard(
    aiService: AiService,
    card: any
  ): Promise<Partial<AiEnrichmentResult>> {
    const extractedText = card.data?.extracted_text;
    if (!extractedText) {
      return {};
    }

    const transcript = await aiService.transcribeDocument(extractedText);
    const summary = await aiService.generateSummary(
      transcript || extractedText,
      'PDF document'
    );
    const tags = await aiService.generateTags(
      transcript || extractedText,
      'PDF document'
    );

    return {
      summary,
      tags,
      transcript,
    };
  }

  private async enrichAudioCard(
    aiService: AiService,
    card: any
  ): Promise<Partial<AiEnrichmentResult>> {
    const mediaUrl = card.data?.media_url;
    if (!mediaUrl) {
      return {};
    }

    try {
      let buffer: Buffer;
      let mimeType: string;

      if (mediaUrl.startsWith('http://') || mediaUrl.startsWith('https://')) {
        // External URL - fetch via HTTP
        console.log(`🔊 Fetching external audio from: ${mediaUrl}`);
        const response = await fetch(mediaUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch audio: ${response.status}`);
        }
        buffer = Buffer.from(await response.arrayBuffer());
        mimeType = response.headers.get('content-type') || 'audio/wav';
      } else {
        // Internal file - read directly from filesystem
        const filePath = mediaUrl.replace('/api/data/', '');
        const fullPath = `/data/${filePath}`;
        console.log(`🔊 Reading audio file from: ${fullPath}`);

        try {
          const file = Bun.file(fullPath);
          if (!(await file.exists())) {
            throw new Error(`Audio file not found: ${fullPath}`);
          }
          buffer = Buffer.from(await file.arrayBuffer());
          mimeType = file.type || 'audio/wav';
        } catch (fileError) {
          console.error(`Failed to read audio file: ${fileError}`);
          throw new Error(`Failed to read audio file: ${fullPath}`);
        }
      }

      const transcript = await aiService.transcribeAudio(buffer, mimeType);
      const summary = await aiService.generateSummary(
        transcript,
        'audio recording'
      );
      const tags = await aiService.generateTags(transcript, 'audio recording');

      return {
        summary,
        tags,
        transcript,
      };
    } catch (error) {
      console.error('Failed to enrich audio card:', error);
      return {};
    }
  }

  private async enrichUrlCard(
    aiService: AiService,
    card: any
  ): Promise<Partial<AiEnrichmentResult>> {
    const url = card.data?.url;
    if (!url) {
      return {};
    }

    try {
      const urlAnalysis = await aiService.extractUrlContent(url);

      return {
        summary: urlAnalysis.description,
        tags: urlAnalysis.tags,
      };
    } catch (error) {
      console.error('Failed to enrich URL card:', error);
      return {};
    }
  }
}
