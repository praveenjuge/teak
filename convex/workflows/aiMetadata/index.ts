import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import { workflow } from "../manager";
import { internal } from "../../_generated/api";
import { cardTypeValidator } from "../../schema";
import type { CardType } from "../../schema";
import type { AiMetadataResult, AiMetadataWorkflowArgs } from "./types";

// Typed internal reference map for workflow helpers
const internalWorkflow = internal as Record<string, any>;
const aiMetadataInternal = internalWorkflow["workflows/aiMetadata/index"] as Record<string, any> | undefined;

const resolveCardType = async (
  step: any,
  args: AiMetadataWorkflowArgs,
): Promise<CardType> => {
  if (args.cardType) {
    return args.cardType;
  }

  const card = await step.runQuery(
    internalWorkflow["ai/queries"].getCardForAI,
    { cardId: args.cardId },
  );

  if (!card?.type) {
    throw new Error(
      `Unable to resolve card type for ${args.cardId}`,
    );
  }

  return card.type as CardType;
};

export const aiMetadataWorkflow = workflow.define({
  args: {
    cardId: v.id("cards"),
    cardType: v.optional(cardTypeValidator),
  },
  returns: v.object({
    aiTags: v.array(v.string()),
    aiSummary: v.string(),
    aiTranscript: v.optional(v.string()),
    confidence: v.number(),
  }),
  handler: async (step, args): Promise<AiMetadataResult> => {
    const cardType = await resolveCardType(step, args);

    const result = await step.runAction(
      internalWorkflow["workflows/steps/metadata"].generate,
      { cardId: args.cardId, cardType },
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
        "AI metadata workflow handle not found (expected internal.workflows/aiMetadata/index)",
      );
    }

    const workflowId = await workflow.start(
      ctx,
      aiMetadataInternal.aiMetadataWorkflow,
      { cardId, cardType: cardType ?? undefined },
      { startAsync: startAsync ?? false },
    );

    return { workflowId };
  },
});

export * from "./actions";
export * from "./generators";
export * from "./mutations";
export * from "./schemas";
export * from "./transcript";
export * from "./types";
