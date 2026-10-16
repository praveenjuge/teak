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
import { generateCardMetadata } from "../workflows/cardProcessing/metadata";
import { isSuperseded } from "../workflows/cardProcessing/run";
import { captureScreenshotStep } from "../workflows/cardProcessing/screenshot";
import type { BackgroundEnv } from "../workflows/runtime";
import { withWorkflowTelemetry } from "../workflows/telemetry";

// Cards whose first processing run left their AI metadata for later (Workers
// AI was busy, its output never validated, AI was paused). Every 6 hours the
// cron claims a batch per deployment; Convex counts each claim and gives a
// card up after a day of attempts.

/** One card whose AI metadata the backfill should (re)generate. */
export interface AiBackfillMessage {
  cardId: string;
  convexSiteUrl: string;
  /** The card's processing revision when it was claimed. */
  rev: number;
}

/** Deliveries a message gets (wrangler.jsonc `max_retries` + 1). */
const MAX_DELIVERIES = 11;

/**
 * Claims the cards one deployment still needs AI metadata for and queues
 * them. Returns how many were queued.
 */
export const enqueueAiBackfill = async (
  env: BackgroundEnv,
  convexSiteUrl: string,
  overrides: Partial<CardProcessingDeps> = {}
): Promise<number> => {
  const queue = env.AI_BACKFILL;
  if (!queue) {
    // Claiming without a queue would spend the cards' attempts on nothing.
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
  // A link's screenshot waits for its AI metadata, as in card processing:
  // one attempt here, recorded on the screenshot stage either way.
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
  }
};

/**
 * Regenerates AI metadata one card at a time. Workers AI capacity retries
 * the message later, a minute more each time; other failures retry on the
 * queue's schedule. A card edited since it was claimed is dropped.
 */
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
