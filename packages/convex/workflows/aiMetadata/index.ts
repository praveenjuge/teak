import type { RetryBehavior } from "@convex-dev/workpool";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { internalMutation } from "../../_generated/server";
import type { CardType } from "../../schema";
import { cardTypeValidator } from "../../schema";
import { startWorkflow, workflow } from "../manager";
import type { AiMetadataResult, AiMetadataWorkflowArgs } from "./types";

// Typed internal reference map for workflow helpers
const internalWorkflow = internal as Record<string, any>;
const aiMetadataInternal = internalWorkflow["workflows/aiMetadata/index"] as
  | Record<string, any>
  | undefined;

const METADATA_STEP_RETRY: RetryBehavior = {
  maxAttempts: 8,
  initialBackoffMs: 400,
  base: 1.8,
};

const resolveCardType = async (
  step: any,
  args: AiMetadataWorkflowArgs
): Promise<CardType> => {
  if (args.cardType) {
    return args.cardType;
  }

  const card = await step.runQuery(
    internalWorkflow["ai/queries"].getCardForAI,
    { cardId: args.cardId }
  );

  if (!card?.type) {
    throw new Error(`Unable to resolve card type for ${args.cardId}`);
  }

  return card.type as CardType;
};

// Matches workflows/steps/metadata.generate, which returns persisted-result
// facts rather than the generated text.
export const aiMetadataWorkflowReturns = v.object({
  aiTagsCount: v.number(),
  hasSummary: v.boolean(),
  hasTranscript: v.boolean(),
  confidence: v.number(),
  mode: v.union(v.literal("completed"), v.literal("skipped")),
});

export const aiMetadataWorkflow = workflow.define({
  args: {
    cardId: v.id("cards"),
    cardType: v.optional(cardTypeValidator),
  },
  returns: aiMetadataWorkflowReturns,
  handler: async (step, args): Promise<AiMetadataResult> => {
    const cardType = await resolveCardType(step, args);

    const result = await step.runAction(
      internalWorkflow["workflows/steps/metadata"].generate,
      { cardId: args.cardId, cardType },
      { retry: METADATA_STEP_RETRY }
    );

    return result;
  },
});

export const startAiMetadataWorkflow = internalMutation({
  args: {
    cardId: v.id("cards"),
    cardType: v.optional(cardTypeValidator),
    startAsync: v.optional(v.boolean()),
  },
  returns: v.object({
    workflowId: v.string(),
  }),
  handler: async (ctx, { cardId, cardType, startAsync }) => {
    if (!aiMetadataInternal) {
      throw new Error(
        "AI metadata workflow handle not found (expected internal.workflows/aiMetadata/index)"
      );
    }

    const workflowId = await startWorkflow(
      ctx,
      aiMetadataInternal.aiMetadataWorkflow,
      { cardId, cardType: cardType ?? undefined },
      { startAsync: startAsync ?? false }
    );

    return { workflowId };
  },
});

export * from "./mutations";
export * from "./schemas";
export * from "./types";
