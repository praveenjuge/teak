import { internal } from "@teak/convex/_generated/api";
import type { Id } from "@teak/convex/_generated/dataModel";
import { allowedConvexSiteUrl } from "../convexRpc";
import { reportBackgroundError } from "../telemetry";
import { isAiProviderCapacityError } from "../workflows/cardProcessing/aiMetadata";
import {
  type CardJob,
  type CardProcessingDeps,
  createCardProcessingDeps,
} from "../workflows/cardProcessing/context";
import { readLinkImageText } from "../workflows/cardProcessing/linkText";
import { generateCardMetadata } from "../workflows/cardProcessing/metadata";
import { transcribePodcastEpisode } from "../workflows/cardProcessing/podcast";
import { isSuperseded } from "../workflows/cardProcessing/run";
import { captureScreenshotStep } from "../workflows/cardProcessing/screenshot";
import type { BackgroundEnv } from "../workflows/runtime";
import { withWorkflowTelemetry } from "../workflows/telemetry";

export interface AiBackfillMessage {
  cardId: string;
  convexSiteUrl: string;
  rev: number;
}

export const MAX_DELIVERIES = 11;

export const enqueueAiBackfill = async (
  env: BackgroundEnv,
  convexSiteUrl: string,
  overrides: Partial<CardProcessingDeps> = {}
): Promise<number> => {
  const queue = env.AI_BACKFILL;
  if (!queue) {
    throw new Error("ai_backfill_queue_missing");
  }
  const { convex } = createCardProcessingDeps(env, convexSiteUrl, overrides);
  const { cards, exhausted } = await convex.mutation(
    internal.ai.backfill.claimAiBackfillCards,
    {}
  );
  if (exhausted > 0) {
    console.warn("[aiBackfill] gave up on cards after repeated failures", {
      exhausted,
    });
  }
  if (cards.length > 0) {
    try {
      await queue.sendBatch(
        cards.map(
          ({
            cardId,
            rev,
          }: {
            cardId: string;
            rev: number;
          }): MessageSendRequest<AiBackfillMessage> => ({
            body: { cardId, convexSiteUrl, rev },
          })
        )
      );
    } catch (error) {
      await convex
        .mutation(internal.ai.backfill.releaseAiBackfillCards, {
          cardIds: cards.map(({ cardId }: { cardId: Id<"cards"> }) => cardId),
        })
        .catch((releaseError: unknown) => {
          console.error("[aiBackfill] could not release claimed cards", {
            error:
              releaseError instanceof Error
                ? releaseError.message
                : String(releaseError),
          });
        });
      throw error;
    }
  }
  return cards.length;
};

const readMessage = (
  env: BackgroundEnv,
  body: unknown
): AiBackfillMessage | null => {
  const { cardId, convexSiteUrl, rev } = (body ?? {}) as Record<
    string,
    unknown
  >;
  const origin = allowedConvexSiteUrl(env, convexSiteUrl);
  return typeof cardId === "string" &&
    cardId &&
    origin &&
    typeof rev === "number" &&
    Number.isSafeInteger(rev)
    ? { cardId, convexSiteUrl: origin, rev }
    : null;
};

const runMessage = async (
  env: BackgroundEnv,
  message: AiBackfillMessage,
  overrides: Partial<CardProcessingDeps>
): Promise<void> => {
  const job: CardJob = {
    cardId: message.cardId as Id<"cards">,
    convexSiteUrl: message.convexSiteUrl,
    deps: createCardProcessingDeps(env, message.convexSiteUrl, overrides),
    env,
    rev: message.rev,
  };
  const result = await withWorkflowTelemetry(env, (telemetry) =>
    generateCardMetadata(job, telemetry, undefined, {
      capacity: "retry",
      restorePendingOnDefer: false,
    })
  );
  if (result.mode === "completed" && result.cardType === "link") {
    await captureScreenshotStep(job, 1, { lastAttempt: true }).catch(
      (error: unknown) => {
        if (isSuperseded(error)) {
          return;
        }
        console.warn("[aiBackfill] screenshot failed", {
          cardId: job.cardId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    );
    await readLinkImageText(job).catch((error: unknown) => {
      if (isSuperseded(error)) {
        return;
      }
      console.warn("[aiBackfill] link image text failed", {
        cardId: job.cardId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    // A podcast episode, which card processing left untranscribed while its
    // AI metadata waited; one attempt, never failing the message.
    await withWorkflowTelemetry(env, (telemetry) =>
      transcribePodcastEpisode(job, telemetry, { keepTranscript: true })
    ).then(
      (outcome) =>
        console.log("[aiBackfill] podcast transcript", {
          cardId: job.cardId,
          ...outcome,
        }),
      (error: unknown) => {
        if (isSuperseded(error)) {
          return;
        }
        console.warn("[aiBackfill] podcast transcript failed", {
          cardId: job.cardId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    );
  }
};

export const handleAiBackfillBatch = async (
  batch: MessageBatch<AiBackfillMessage>,
  env: BackgroundEnv,
  overrides: Partial<CardProcessingDeps> = {}
): Promise<void> => {
  for (const message of batch.messages) {
    const body = readMessage(env, message.body);
    if (!body) {
      console.error("[aiBackfill] dropped an unreadable message", {
        id: message.id,
      });
      message.ack();
      continue;
    }
    try {
      await runMessage(env, body, overrides);
      message.ack();
    } catch (error) {
      if (
        isSuperseded(error) ||
        (error instanceof Error && error.name === "NonRetryableError")
      ) {
        message.ack();
        continue;
      }
      if (isAiProviderCapacityError(error)) {
        message.retry({ delaySeconds: 60 * message.attempts });
        continue;
      }
      if (message.attempts >= MAX_DELIVERIES) {
        await reportBackgroundError(env, undefined, error, {
          "card.id": body.cardId,
          task: "ai-backfill",
        }).catch(() => undefined);
      }
      message.retry();
    }
  }
};
