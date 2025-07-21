import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { cards, jobs } from '../../db/schema.js';
import { AiEnrichmentService } from '../ai/ai-enrichment-service.js';
import { ScreenshotService } from '../screenshot/ScreenshotService.js';

export interface CreateJobRequest {
  type:
    | 'refetch-og-images'
    | 'refetch-screenshots'
    | 'refresh-ai-data'
    | 'process-card'
    | 'ai-enrich-text'
    | 'ai-enrich-image'
    | 'ai-enrich-pdf'
    | 'ai-enrich-audio'
    | 'ai-enrich-url';
  userId: string;
  payload: Record<string, unknown>;
}

export class JobService {
  private screenshotService: ScreenshotService;
  private aiEnrichmentService: AiEnrichmentService;

  constructor() {
    this.screenshotService = new ScreenshotService();
    this.aiEnrichmentService = new AiEnrichmentService();
  }

  async createJob(request: CreateJobRequest) {
    const [job] = await db
      .insert(jobs)
      .values({
        type: request.type,
        userId: request.userId,
        payload: request.payload,
        status: 'pending',
      })
      .returning();

    if (!job) {
      throw new Error('Failed to create job');
    }

    return job;
  }

  async processJob(jobId: number) {
    // Mark job as processing
    const [job] = await db
      .update(jobs)
      .set({
        status: 'processing',
        startedAt: new Date(),
      })
      .where(eq(jobs.id, jobId))
      .returning();

    if (!job) {
      console.log(`❌ Job ${jobId} not found`);
      throw new Error('Job not found');
    }

    console.log(`🚀 Processing job ${jobId}:`, {
      type: job.type,
      status: job.status,
      userId: job.userId,
      payload: job.payload,
    });

    try {
      let result: Record<string, unknown> = {};

      switch (job.type) {
        case 'refetch-og-images':
          result = await this.processRefetchOgImages(job.userId);
          break;
        case 'refetch-screenshots':
          result = await this.processRefetchScreenshots(job.userId);
          break;
        case 'refresh-ai-data':
          result = await this.processRefreshAiData(job.userId);
          break;
        case 'ai-enrich-text':
        case 'ai-enrich-image':
        case 'ai-enrich-pdf':
        case 'ai-enrich-audio':
        case 'ai-enrich-url':
          console.log(`🤖 Processing AI enrichment job: ${job.type}`);
          result = await this.processAiEnrichment(
            job.userId,
            job.payload as Record<string, unknown>
          );
          break;
        default:
          throw new Error(`Unsupported job type: ${job.type}`);
      }

      // Mark job as completed
      console.log(`✅ Job ${jobId} processed successfully, result:`, result);

      await db
        .update(jobs)
        .set({
          status: 'completed',
          completedAt: new Date(),
          result,
        })
        .where(eq(jobs.id, jobId));

      console.log(`🎉 Job ${jobId} marked as completed successfully`);
    } catch (error) {
      console.error(`Job ${jobId} failed:`, error);

      // Mark job as failed
      await db
        .update(jobs)
        .set({
          status: 'failed',
          completedAt: new Date(),
          error: error instanceof Error ? error.message : 'Unknown error',
        })
        .where(eq(jobs.id, jobId));
    }
  }

  private async processRefetchOgImages(
    userId: string
  ): Promise<Record<string, unknown>> {
    // Get all URL cards for the user
    const urlCards = await db
      .select()
      .from(cards)
      .where(
        and(
          eq(cards.userId, userId),
          eq(cards.type, 'url'),
          isNull(cards.deletedAt)
        )
      );

    const results = {
      total: urlCards.length,
      processed: 0,
      errors: [] as string[],
    };

    for (const card of urlCards) {
      try {
        const cardData = card.data as { url: string; image?: string };
        if (!cardData.url) {
          continue;
        }

        // Extract OG image URL
        const response = await fetch(cardData.url, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (compatible; Teak/1.0; +https://teak.app)',
          },
        });

        if (!response.ok) {
          continue;
        }

        const html = await response.text();
        const ogImageMatch = html.match(
          /<meta\s+property="og:image"\s+content="([^"]+)"/i
        );

        if (ogImageMatch?.[1]) {
          const ogImageUrl = ogImageMatch[1];

          // Download and save the OG image
          const ogImageResult =
            await this.screenshotService.downloadAndSaveOgImage(
              ogImageUrl,
              cardData.url,
              userId
            );

          // Update the card with new OG image data
          await db
            .update(cards)
            .set({
              data: {
                ...cardData,
                image: ogImageUrl,
                screenshot_url: ogImageResult.url,
              },
              updatedAt: new Date(),
            })
            .where(eq(cards.id, card.id));

          results.processed++;
        }
      } catch (error) {
        console.warn(`Failed to refetch OG image for card ${card.id}:`, error);
        results.errors.push(
          `Card ${card.id}: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    return results;
  }

  private async processRefetchScreenshots(
    userId: string
  ): Promise<Record<string, unknown>> {
    // Get all URL cards for the user
    const urlCards = await db
      .select()
      .from(cards)
      .where(
        and(
          eq(cards.userId, userId),
          eq(cards.type, 'url'),
          isNull(cards.deletedAt)
        )
      );

    const results = {
      total: urlCards.length,
      processed: 0,
      errors: [] as string[],
    };

    for (const card of urlCards) {
      try {
        const cardData = card.data as { url: string; screenshot_url?: string };
        if (!cardData.url) {
          continue;
        }

        // Take a new screenshot
        const screenshotResult = await this.screenshotService.takeScreenshot(
          cardData.url,
          userId,
          {
            width: 1200,
            height: 800,
            format: 'jpeg',
            quality: 85,
          }
        );

        // Update the card with new screenshot URL
        await db
          .update(cards)
          .set({
            data: {
              ...cardData,
              screenshot_url: screenshotResult.url,
            },
            updatedAt: new Date(),
          })
          .where(eq(cards.id, card.id));

        results.processed++;
      } catch (error) {
        console.warn(
          `Failed to refetch screenshot for card ${card.id}:`,
          error
        );
        results.errors.push(
          `Card ${card.id}: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    return results;
  }

  private async processAiEnrichment(
    userId: string,
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const cardId = payload.cardId as number;

    console.log(
      `🤖 Processing AI enrichment - userId: ${userId}, payload:`,
      payload
    );

    if (!cardId || typeof cardId !== 'number') {
      console.log('❌ Invalid card ID for AI enrichment:', {
        cardId,
        type: typeof cardId,
      });
      throw new Error('Card ID is required for AI enrichment');
    }

    console.log(
      `🎯 Calling AI enrichment service for card ${cardId}, user ${userId}`
    );

    try {
      await this.aiEnrichmentService.enrichCard(cardId, userId);

      return {
        cardId,
        success: true,
      };
    } catch (error) {
      console.error(`Failed to enrich card ${cardId}:`, error);
      throw error;
    }
  }

  private async processRefreshAiData(
    userId: string
  ): Promise<Record<string, unknown>> {
    // Get all cards for the user that don't have a deletedAt timestamp
    const allCards = await db
      .select()
      .from(cards)
      .where(and(eq(cards.userId, userId), isNull(cards.deletedAt)));

    const results = {
      total: allCards.length,
      processed: 0,
      errors: [] as string[],
    };

    for (const card of allCards) {
      try {
        // Reset AI processing timestamp to allow re-processing
        await db
          .update(cards)
          .set({
            aiProcessedAt: null,
            updatedAt: new Date(),
          })
          .where(eq(cards.id, card.id));

        // Re-enrich the card
        await this.aiEnrichmentService.enrichCard(card.id, userId);
        results.processed++;
      } catch (error) {
        console.warn(`Failed to refresh AI data for card ${card.id}:`, error);
        results.errors.push(
          `Card ${card.id}: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    return results;
  }
}
